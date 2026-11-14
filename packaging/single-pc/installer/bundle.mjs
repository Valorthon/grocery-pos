// Offline installation bundle builder (#362). Runs on the vendor's build
// machine (Linux or Windows) with network access; the store never downloads
// anything. It fetches the pinned components in ../components.json (or reuses
// a cache), refuses any SHA-256 mismatch, lays them out as the release tree
// that ../runtime/layout.mjs `releaseLayout` describes, adds the compiled
// API/contracts (production dependencies, Windows prebuilds only), the client
// built with VITE_APP_ENV=single-pc, the maintenance tools and the notices,
// and writes a per-file SHA-256 manifest that the installer verifies.
//
//   node bundle.mjs --out <new dir> [--cache <dir>] [--offline]
//                   [--version <release>] [--skip-app-build]
//
// Exit codes: 0 built, 1 failed, 2 usage, 3 refused (nothing written).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    cp,
    mkdir,
    readFile,
    readdir,
    rename,
    rm,
    stat,
    writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readZip } from './zip.mjs';

export const EXIT = { OK: 0, FAILED: 1, USAGE: 2, REFUSED: 3 };
export const BUNDLE_SCHEMA = 1;
export const MANIFEST = 'bundle-manifest.json';
export const SUMS = 'SHA256SUMS';

const here = dirname(fileURLToPath(import.meta.url));
export const SINGLE_PC = resolve(here, '..');
export const REPO = resolve(SINGLE_PC, '..', '..');

export class RefusedError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RefusedError';
    }
}

/** Files the release must contain (Windows names), relative to release/. */
export const REQUIRED_RELEASE_FILES = Object.freeze([
    'node/node.exe',
    'mongodb/bin/mongod.exe',
    'mongodb/bin/mongodump.exe',
    'mongodb/bin/mongorestore.exe',
    'caddy/caddy.exe',
    'caddy/Caddyfile',
    'services/WinSW.exe',
    'api/package.json',
    'api/dist/main.js',
    'api/dist/bootstrap/initial-admin.cli.js',
    'client/index.html',
    'tools/runtime/layout.mjs',
    'tools/runtime/provision.mjs',
    'tools/backup/backup.mjs',
    'tools/installer/install.mjs',
    'tools/installer/Launch.ps1',
    'tools/installer/ExportReminder.ps1',
    'notices/COMPONENTS.md',
    'VERSION.json',
]);

/** Packaging scripts shipped as maintenance tools (tests excluded). */
export const TOOL_DIRS = Object.freeze(['runtime', 'backup', 'installer']);

export function sha256(buffer) {
    return createHash('sha256').update(buffer).digest('hex');
}

/** Components that the bundle ships, validated before any download. */
export function bundledComponents(components) {
    const out = [];
    for (const [key, value] of Object.entries(components)) {
        if (!value || typeof value !== 'object' || !value.bundle) continue;
        if (!/^https:\/\//.test(value.url ?? '')) {
            throw new RefusedError(`${key}: an https URL is required.`);
        }
        if (!/^[a-f0-9]{64}$/.test(value.sha256 ?? '')) {
            throw new RefusedError(`${key}: a pinned SHA-256 is required.`);
        }
        if (!value.license) {
            throw new RefusedError(`${key}: its license must be recorded.`);
        }
        out.push({ key, ...value });
    }
    return out;
}

function cacheName(component) {
    return `${component.sha256.slice(0, 16)}-${component.url.split('/').pop()}`;
}

/** The verified archive bytes: from the cache, else downloaded. A cached or
 *  downloaded file with another hash is refused, never used or replaced. */
export async function acquire(component, { cache, offline, fetchImpl }) {
    const path = join(cache, cacheName(component));
    let bytes = await readFile(path).catch(() => undefined);
    if (bytes === undefined) {
        if (offline) {
            throw new RefusedError(
                `${component.key}: not in the cache and --offline was given.`,
            );
        }
        const response = await (fetchImpl ?? fetch)(component.url);
        if (!response.ok) {
            throw new Error(
                `${component.key}: download failed (${response.status}).`,
            );
        }
        bytes = Buffer.from(await response.arrayBuffer());
        if (sha256(bytes) !== component.sha256) {
            throw new RefusedError(
                `${component.key}: SHA-256 mismatch on download.`,
            );
        }
        await mkdir(cache, { recursive: true });
        await writeFile(path, bytes);
    }
    if (sha256(bytes) !== component.sha256) {
        throw new RefusedError(
            `${component.key}: cached archive has another SHA-256; delete ${path} and rebuild.`,
        );
    }
    return bytes;
}

/** Where an archive entry goes in the release, or undefined (dropped). */
export function placeEntry(component, name) {
    const { strip = 0, map = [], notices = false } = component.bundle;
    const parts = name.split('/');
    if (parts.length <= strip) return undefined;
    const rest = parts.slice(strip).join('/');
    for (const [from, to] of map) {
        if (from === rest) return to;
        if ((from === '' || from.endsWith('/')) && rest.startsWith(from)) {
            return to + rest.slice(from.length);
        }
    }
    if (notices && !rest.includes('/'))
        return `notices/${component.key}/${rest}`;
    return undefined;
}

/** Writes a verified component into the release tree. */
export async function placeComponent(component, bytes, release) {
    const placed = [];
    const write = async (to, data) => {
        const target = join(release, ...to.split('/'));
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, data, { flag: 'wx' });
        placed.push(to);
    };
    if (component.bundle.archive === 'file') {
        await write(component.bundle.to, bytes);
        return placed;
    }
    if (component.bundle.archive !== 'zip') {
        throw new Error(`${component.key}: unknown archive kind.`);
    }
    for (const entry of readZip(bytes)) {
        if (entry.directory) continue;
        const to = placeEntry(component, entry.name);
        if (to) await write(to, entry.data());
    }
    if (placed.length === 0) {
        throw new Error(`${component.key}: nothing matched its bundle map.`);
    }
    return placed;
}

export async function listFiles(dir) {
    const out = [];
    async function walk(current) {
        const entries = await readdir(current, { withFileTypes: true });
        for (const entry of entries.sort((a, b) =>
            a.name.localeCompare(b.name),
        )) {
            const full = join(current, entry.name);
            if (entry.isSymbolicLink()) {
                throw new RefusedError(
                    `Symbolic links cannot ship: ${relative(dir, full)}`,
                );
            }
            if (entry.isDirectory()) await walk(full);
            else out.push(relative(dir, full).split(sep).join('/'));
        }
    }
    await walk(dir);
    return out;
}

/** `{ relativePath: sha256 }` for every file under dir. */
export async function hashTree(dir) {
    const files = {};
    for (const file of await listFiles(dir)) {
        files[file] = sha256(await readFile(join(dir, ...file.split('/'))));
    }
    return files;
}

/**
 * Checks a tree against manifest `files` (paths relative to `dir`, under
 * `prefix`): every listed file present with its hash, nothing unlisted.
 */
export async function verifyTree(dir, files, prefix = '') {
    const expected = Object.entries(files)
        .filter(([path]) => path.startsWith(prefix))
        .map(([path, hash]) => [path.slice(prefix.length), hash]);
    const actual = await hashTree(dir).catch((error) => {
        if (error.code === 'ENOENT') return {};
        throw error;
    });
    const problems = [];
    for (const [path, hash] of expected) {
        if (actual[path] === undefined) problems.push(`missing ${path}`);
        else if (actual[path] !== hash) problems.push(`changed ${path}`);
    }
    const known = new Set(expected.map(([path]) => path));
    for (const path of Object.keys(actual)) {
        if (!known.has(path)) problems.push(`unexpected ${path}`);
    }
    return problems;
}

/** Native addons must be Windows x64 builds; other prebuilds are removed. */
export async function pruneNativeAddons(apiDir) {
    const removed = [];
    async function walk(current) {
        for (const entry of await readdir(current, { withFileTypes: true })) {
            const full = join(current, entry.name);
            if (!entry.isDirectory()) continue;
            if (entry.name === 'prebuilds') {
                for (const platform of await readdir(full)) {
                    if (platform !== 'win32-x64') {
                        await rm(join(full, platform), { recursive: true });
                        removed.push(relative(apiDir, join(full, platform)));
                    }
                }
            } else {
                await walk(full);
            }
        }
    }
    await walk(apiDir);
    const addons = (await listFiles(apiDir)).filter((f) => f.endsWith('.node'));
    const foreign = addons.filter((f) => !f.includes('/prebuilds/win32-x64/'));
    if (foreign.length) {
        throw new RefusedError(
            `Native addons without a Windows x64 prebuild: ${foreign.join(', ')}`,
        );
    }
    if (!addons.some((f) => f.includes('/argon2/'))) {
        throw new RefusedError('argon2 has no Windows x64 prebuild.');
    }
    return removed;
}

/** Copies the packaging tools (no tests) into release/tools. */
export async function copyTools(release) {
    for (const dir of TOOL_DIRS) {
        for (const file of await readdir(join(SINGLE_PC, dir))) {
            if (!/\.(mjs|ps1)$/.test(file) || /\.test\.mjs$/.test(file))
                continue;
            await cp(
                join(SINGLE_PC, dir, file),
                join(release, 'tools', dir, file),
            );
        }
    }
    // provision.mjs and backup.mjs import its bounded wait.
    await cp(
        join(SINGLE_PC, 'proof', 'policy.mjs'),
        join(release, 'tools', 'proof', 'policy.mjs'),
    );
    await cp(
        join(SINGLE_PC, 'caddy', 'Caddyfile'),
        join(release, 'caddy', 'Caddyfile'),
    );
}

/** notices/COMPONENTS.md: what ships, under which license, and where the
 *  corresponding source is (ARCHITECTURE.md "Distribution obligations"). */
export function componentsNotice(components, { version, commit }) {
    const rows = bundledComponents(components).map(
        (c) =>
            `| ${c.name ?? c.key} | ${c.version} | ${c.license} | ${c.source ?? c.url} | \`${c.sha256}\` |`,
    );
    return [
        `# Grocery POS single-PC release ${version}`,
        '',
        `Built from commit ${commit}. Every component below was verified against`,
        'its pinned SHA-256 before it was added. License texts and upstream',
        'third-party notices are in the per-component folders beside this file',
        '(Node.js keeps its own in `node/`).',
        '',
        '| Component | Version | License | Source | Archive SHA-256 |',
        '| --------- | ------- | ------- | ------ | --------------- |',
        ...rows,
        '',
        '## MongoDB Community Server (SSPL-1.0)',
        '',
        'MongoDB is shipped unmodified, as published at the URL above. Its',
        'corresponding source is published by MongoDB, Inc. at',
        `https://github.com/mongodb/mongo/tree/r${components.mongodb.version}.`,
        'The vendor also keeps a copy of that source for this release and',
        'provides it on request on the same medium as this bundle.',
        '',
        'API and client dependency licenses are in `api-dependencies.json` and',
        '`client-dependencies.json`.',
        '',
    ].join('\n');
}

/** License summary of a production node_modules tree (hoisted layout). */
export async function dependencyLicenses(nodeModules) {
    const out = [];
    async function visit(dir) {
        const entries = await readdir(dir, { withFileTypes: true }).catch(
            () => [],
        );
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
            const full = join(dir, entry.name);
            if (entry.name.startsWith('@')) {
                await visit(full);
                continue;
            }
            const pkg = await readFile(join(full, 'package.json'), 'utf8')
                .then(JSON.parse)
                .catch(() => undefined);
            if (!pkg?.name) continue;
            const files = (await readdir(full)).filter((f) =>
                /^(licen[cs]e|notice|copying)/i.test(f),
            );
            out.push({
                name: pkg.name,
                version: pkg.version,
                license: pkg.license ?? null,
                files,
            });
            await visit(join(full, 'node_modules'));
        }
    }
    await visit(nodeModules);
    return out.sort((a, b) =>
        `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
    );
}

function run(command, args, options = {}) {
    execFileSync(command, args, {
        cwd: REPO,
        stdio: ['ignore', 'inherit', 'inherit'],
        env: { ...process.env, HUSKY: '0', ...options.env },
        shell: process.platform === 'win32',
    });
}

/** Builds contracts, API and the single-pc client, and lays them out. */
export async function buildApp(release, scratch) {
    run('pnpm', ['--filter', '@grocery-pos/contracts', 'build']);
    run('pnpm', ['--filter', 'grocery-pos-api', 'build']);
    run('pnpm', ['--filter', 'grocery-pos-client', 'build'], {
        env: {
            VITE_APP_ENV: 'single-pc',
            VITE_API_URL: '/v1',
            VITE_DOMAIN: '',
            VITE_API_TIMEOUT: '15000',
        },
    });
    const deployed = join(scratch, 'api-deploy');
    // Hoisted: real directories, no symlinks, so the tree survives copying
    // to removable media and NTFS without Developer Mode.
    run('pnpm', [
        '--filter',
        'grocery-pos-api',
        'deploy',
        '--prod',
        '--legacy',
        '--config.node-linker=hoisted',
        deployed,
    ]);
    const api = join(release, 'api');
    await mkdir(api, { recursive: true });
    await cp(join(deployed, 'package.json'), join(api, 'package.json'));
    await cp(join(deployed, 'node_modules'), join(api, 'node_modules'), {
        recursive: true,
        filter: (src) => !src.split(sep).includes('.bin'),
    });
    await cp(join(REPO, 'apps', 'api', 'dist'), join(api, 'dist'), {
        recursive: true,
    });
    await pruneNativeAddons(api);
    await cp(join(REPO, 'apps', 'client', 'dist'), join(release, 'client'), {
        recursive: true,
    });
    const clientLicenses = execFileSync(
        'pnpm',
        [
            '--filter',
            'grocery-pos-client',
            'licenses',
            'list',
            '--prod',
            '--json',
        ],
        { cwd: REPO, encoding: 'utf8', shell: process.platform === 'win32' },
    );
    await writeFile(
        join(release, 'notices', 'client-dependencies.json'),
        clientLicenses,
    );
    await writeFile(
        join(release, 'notices', 'api-dependencies.json'),
        JSON.stringify(
            await dependencyLicenses(join(api, 'node_modules')),
            null,
            2,
        ) + '\n',
    );
}

function gitCommit() {
    try {
        return execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: REPO,
            encoding: 'utf8',
        }).trim();
    } catch {
        return 'unknown';
    }
}

export async function buildBundle(options, log = () => {}) {
    const out = resolve(options.out);
    if (await stat(out).catch(() => undefined)) {
        throw new RefusedError(`${out} already exists; choose a new folder.`);
    }
    const components =
        options.components ??
        JSON.parse(await readFile(join(SINGLE_PC, 'components.json'), 'utf8'));
    const shipped = bundledComponents(components);
    const commit = options.commit ?? gitCommit();
    const apiPkg = JSON.parse(
        await readFile(join(REPO, 'apps', 'api', 'package.json'), 'utf8'),
    );
    const version =
        options.version ?? `${apiPkg.version}-${commit.slice(0, 12)}`;
    if (!/^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/.test(version)) {
        throw new RefusedError('--version must be a plain release name.');
    }
    const stage = `${out}.partial`;
    await rm(stage, { recursive: true, force: true });
    const release = join(stage, 'release');
    await mkdir(join(release, 'notices'), { recursive: true });
    try {
        for (const component of shipped) {
            log(`component: ${component.key} ${component.version}`);
            const bytes = await acquire(component, {
                cache: resolve(options.cache ?? join(out, '..', '.gpos-cache')),
                offline: options.offline,
                fetchImpl: options.fetchImpl,
            });
            await placeComponent(component, bytes, release);
        }
        await copyTools(release);
        if (options.buildApp !== false) {
            log('app: building contracts, API and single-pc client');
            const work = `${out}.build`;
            await rm(work, { recursive: true, force: true });
            try {
                await (options.buildApp ?? buildApp)(release, work);
            } finally {
                await rm(work, { recursive: true, force: true });
            }
        }
        await writeFile(
            join(release, 'notices', 'COMPONENTS.md'),
            componentsNotice(components, { version, commit }),
        );
        const versionInfo = {
            schema: BUNDLE_SCHEMA,
            version,
            commit,
            appVersion: apiPkg.version,
            builtAt: (options.now ?? new Date()).toISOString(),
            platform: components.platform,
            components: Object.fromEntries(
                shipped.map((c) => [
                    c.key,
                    { version: c.version, sha256: c.sha256 },
                ]),
            ),
        };
        await writeFile(
            join(release, 'VERSION.json'),
            JSON.stringify(versionInfo, null, 2) + '\n',
        );
        await cp(
            join(SINGLE_PC, 'installer', 'Install.ps1'),
            join(stage, 'Install.ps1'),
        );
        await cp(
            join(SINGLE_PC, 'installer', 'README-BUNDLE.txt'),
            join(stage, 'README.txt'),
        );

        const files = await hashTree(stage);
        const missing = REQUIRED_RELEASE_FILES.filter(
            (f) => files[`release/${f}`] === undefined,
        );
        if (options.buildApp !== false && missing.length) {
            throw new RefusedError(
                `Release is incomplete: ${missing.join(', ')}`,
            );
        }
        const manifest = { ...versionInfo, files };
        await writeFile(
            join(stage, MANIFEST),
            JSON.stringify(manifest, null, 2) + '\n',
        );
        await writeFile(
            join(stage, SUMS),
            Object.entries({
                ...files,
                [MANIFEST]: sha256(await readFile(join(stage, MANIFEST))),
            })
                .map(([path, hash]) => `${hash}  ${path}`)
                .join('\n') + '\n',
        );
        await rename(stage, out);
        log(`bundle: ${out}`);
        return { out, version, files: Object.keys(files).length };
    } catch (error) {
        await rm(stage, { recursive: true, force: true });
        throw error;
    }
}

export function parseArgs(args) {
    const out = {};
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const value = () => {
            const next = args[++i];
            if (next === undefined || next.startsWith('--')) {
                throw new Error(`${arg} needs a value.`);
            }
            return next;
        };
        if (arg === '--out') out.out = value();
        else if (arg === '--cache') out.cache = value();
        else if (arg === '--version') out.version = value();
        else if (arg === '--offline') out.offline = true;
        else if (arg === '--skip-app-build') out.buildApp = false;
        else throw new Error(`Unknown option ${arg}.`);
    }
    if (!out.out) throw new Error('--out is required.');
    return out;
}

async function main() {
    let options;
    try {
        options = parseArgs(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        return EXIT.USAGE;
    }
    try {
        const result = await buildBundle(options, (line) =>
            process.stdout.write(`${line}\n`),
        );
        process.stdout.write(`${JSON.stringify(result)}\n`);
        return EXIT.OK;
    } catch (error) {
        process.stderr.write(
            `${error instanceof RefusedError ? 'Refused' : 'Failed'}: ${error.message}\n`,
        );
        return error instanceof RefusedError ? EXIT.REFUSED : EXIT.FAILED;
    }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    process.exit(await main());
}
