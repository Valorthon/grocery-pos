// Test-only helpers for the upgrade tests (#364): fake release bundles and
// a POSIX "service manager" context that runs a real mongod and a stand-in
// API process from pid files, so a separate (killed) process can control
// the same services. No tests here; the *.test.mjs name keeps it out of
// the shipped tools (bundle.mjs copyTools).
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundedWait } from '../proof/policy.mjs';
import { layout, PORTS, SERVICES } from '../runtime/layout.mjs';
import { provision } from '../runtime/provision.mjs';
import { buildBundle, sha256, MANIFEST } from '../installer/bundle.mjs';
import { locations } from '../installer/plan.mjs';
import { diagnose } from '../diagnostics/diagnose.mjs';
import { dataCompatibility } from './migrations.mjs';
import { writeZip } from '../installer/zip.mjs';

export const repo = fileURLToPath(new URL('../../..', import.meta.url));
export const repoApi = join(repo, 'apps', 'api');
const components = JSON.parse(
    await readFile(new URL('../components.json', import.meta.url), 'utf8'),
);

export const okFacts = {
    platform: 'win32',
    osBuild: 26100,
    osArchitecture: 'X64',
    serverEdition: false,
    isAdmin: true,
    dotNetRelease: 533320,
    chrome: true,
    portsBusy: [],
    freeBytes: { program: 10 * 1024 ** 3, data: 50 * 1024 ** 3 },
};

/** Data migrations a test release carries (1 → 2). Idempotent per the
 *  registry contract; `slowMs` paces it so a test can kill it midway. */
export function testMigrations({ slowMs = 0, failAfter } = {}) {
    return [
        {
            id: 'test-flag-sales',
            from: 1,
            to: 2,
            changesData: true,
            async up(db) {
                const sales = db.collection('sales');
                let n = 0;
                for (const doc of await sales
                    .find({ migrated: { $exists: false } })
                    .toArray()) {
                    await sales.updateOne(
                        { _id: doc._id, migrated: { $exists: false } },
                        { $set: { migrated: true } },
                    );
                    n++;
                    if (failAfter !== undefined && n >= failAfter)
                        throw new Error('migration failed on purpose');
                    if (slowMs)
                        await new Promise((done) => setTimeout(done, slowMs));
                }
            },
        },
    ];
}

/** The stand-in API: refuses data of another version, like the real one. */
function fakeApiSource() {
    return `const { createRequire } = require('node:module');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { MongoClient } = createRequire(${JSON.stringify(join(repoApi, 'package.json'))})('mongoose').mongo;
const info = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'VERSION.json'), 'utf8'));
const want = info.data ? info.data.dataVersion : 1;
(async () => {
    const client = new MongoClient(process.env.DATABASE_URL, { serverSelectionTimeoutMS: 20000 });
    await client.connect();
    const m = await client.db().collection('systemdataversion').findOne({ _id: 'data' });
    const v = m ? m.dataVersion : 1;
    const st = m ? m.state : 'ready';
    if (st !== 'ready' || v !== want) {
        console.error('refusing data version ' + v + ' (' + st + '), need ' + want);
        process.exit(1);
    }
    http.createServer((q, r) => { r.writeHead(q.url.startsWith('/v1/health') ? 200 : 404); r.end('{}'); })
        .listen(${PORTS.api}, '127.0.0.1');
    process.on('SIGTERM', () => process.exit(0));
})().catch((e) => { console.error(e.message); process.exit(1); });
`;
}

function fakeComponents({ mongodb } = {}) {
    const archives = {
        node: writeZip({ 'node-v/node.exe': 'node', 'node-v/LICENSE': 'MIT' }),
        mongodb: writeZip({
            'mongo-v/bin/mongod.exe': 'mongod',
            'mongo-v/LICENSE-Community.txt': 'SSPL',
        }),
        mongodbTools: writeZip({
            'tools-v/bin/mongodump.exe': 'dump',
            'tools-v/bin/mongorestore.exe': 'restore',
            'tools-v/LICENSE.md': 'Apache',
        }),
        proxy: writeZip({ 'caddy.exe': 'caddy', LICENSE: 'Apache' }),
        serviceHost: Buffer.from('winsw'),
        serviceHostLicense: Buffer.from('MIT'),
    };
    const fake = structuredClone(components);
    for (const [key, bytes] of Object.entries(archives)) {
        fake[key].url = `https://example.invalid/${key}`;
        fake[key].sha256 = sha256(bytes);
    }
    if (mongodb) fake.mongodb.version = mongodb;
    const fetchImpl = async (url) => ({
        ok: true,
        arrayBuffer: async () => archives[url.split('/').pop()],
    });
    return { fake, fetchImpl };
}

/** A release bundle plus the pinned manifest copy Install.ps1 would pass. */
export async function makeBundle(
    dir,
    { version, appVersion, migrations = [], dataVersion = 1, mongodb, apiMain },
) {
    const { fake, fetchImpl } = fakeComponents({ mongodb });
    const out = join(dir, `bundle-${version}`);
    await buildBundle({
        out,
        cache: join(dir, 'cache'),
        components: fake,
        fetchImpl,
        commit: 'a'.repeat(40),
        version,
        appVersion,
        data: dataCompatibility(migrations, dataVersion),
        buildApp: async (release) => {
            const files = {
                'api/package.json': JSON.stringify({
                    name: 'grocery-pos-api',
                    version: appVersion,
                }),
                'api/dist/main.js': apiMain ?? fakeApiSource(),
                'api/dist/bootstrap/initial-admin.cli.js': '',
                'client/index.html': `<!doctype html><!-- ${version} -->`,
                'client/favicon.ico': '',
            };
            for (const [path, text] of Object.entries(files)) {
                await mkdir(join(release, path, '..'), { recursive: true });
                await writeFile(join(release, path), text);
            }
        },
    });
    const pinned = join(dir, `pinned-${version}`);
    await mkdir(pinned, { recursive: true });
    const bytes = await readFile(join(out, MANIFEST));
    await writeFile(join(pinned, MANIFEST), bytes);
    return {
        bundle: out,
        manifest: join(pinned, MANIFEST),
        manifestSha256: sha256(bytes),
    };
}

function portOpen(port) {
    return new Promise((done) => {
        const s = connect({ host: '127.0.0.1', port });
        s.once('connect', () => (s.destroy(), done(true)));
        s.once('error', () => done(false));
    });
}

function alive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/**
 * Installer + upgrade context for Linux: Windows commands are recorded,
 * services are real processes tracked by pid files under `dir/svc`.
 */
export function posixContext(dir, { mongod, tools, migrations, fault } = {}) {
    const where = locations({
        ProgramFiles: join(dir, 'pf'),
        ProgramData: join(dir, 'pd'),
        PUBLIC: join(dir, 'public'),
    });
    const paths = layout(where.dataRoot);
    const svc = join(dir, 'svc');
    const pidFile = (name) => join(svc, `${name}.pid`);
    const registered = join(svc, 'registered.json');
    const readRegistered = async () =>
        JSON.parse(await readFile(registered, 'utf8').catch(() => '{}'));
    const writeRegistered = async (r) => {
        await mkdir(svc, { recursive: true });
        await writeFile(registered, JSON.stringify(r));
    };
    const pidOf = async (name) => {
        const pid = Number(
            await readFile(pidFile(name), 'utf8').catch(() => 0),
        );
        return pid && alive(pid) ? pid : 0;
    };
    const log = [];
    const ctx = {
        windows: true,
        locations: where,
        log,
        migrations,
        fault,
        readyTimeoutMs: 30_000,
        async facts() {
            return {
                ...okFacts,
                servicesInstalled: Object.keys(await readRegistered()),
            };
        },
        async exec(file, args) {
            log.push([file, ...args]);
            const r = await readRegistered();
            if (args.includes('--install')) r[SERVICES.mongo] = 'auto';
            if (args[0] === 'install')
                r[file.split('/').pop().replace('.exe', '')] = 'auto';
            if (file === 'sc.exe' && args[0] === 'delete') delete r[args[1]];
            if (
                file === 'sc.exe' &&
                args[0] === 'config' &&
                args.includes('start=')
            )
                r[args[1]] = args[args.indexOf('start=') + 1];
            await writeRegistered(r);
            if (args.some((a) => String(a).endsWith('initial-admin.cli.js')))
                return { code: 3 };
            return { code: 0 };
        },
        provision: (options) => provision({ ...options, mongod, api: repoApi }),
        async startService(name) {
            log.push(['start', name]);
            if (await pidOf(name)) return;
            if (name === SERVICES.proxy) return;
            await mkdir(svc, { recursive: true });
            const state = JSON.parse(
                await readFile(
                    join(paths.dirs.state, 'installer.json'),
                    'utf8',
                ),
            );
            const child =
                name === SERVICES.mongo
                    ? spawn(mongod, ['--config', paths.mongodConfig], {
                          stdio: 'ignore',
                          detached: true,
                      })
                    : spawn(
                          process.execPath,
                          [
                              `--env-file=${paths.apiEnv}`,
                              join(state.release, 'api', 'dist', 'main.js'),
                          ],
                          { stdio: 'ignore', detached: true },
                      );
            child.unref();
            await writeFile(pidFile(name), String(child.pid));
        },
        async stopService(name) {
            const pid = await pidOf(name);
            if (!pid) return;
            log.push(['stop', name]);
            process.kill(pid, 'SIGTERM');
            await boundedWait(async () => !alive(pid), {
                timeoutMs: 60_000,
                intervalMs: 200,
            });
            await rm(pidFile(name), { force: true });
        },
        async setStartMode(name, mode) {
            log.push(['mode', name, mode]);
            const r = await readRegistered();
            if (r[name]) r[name] = mode;
            await writeRegistered(r);
        },
        async waitServiceGone() {},
        async waitReady(name) {
            if (name === SERVICES.proxy) return;
            const port = name === SERVICES.mongo ? PORTS.mongo : PORTS.api;
            await boundedWait(
                async () => {
                    if (!(await pidOf(name)))
                        throw new Error(`${name} exited during startup.`);
                    return portOpen(port);
                },
                { timeoutMs: 60_000, intervalMs: 250 },
            );
        },
        async waitFile() {},
        async createShortcuts(targets) {
            for (const path of targets) {
                await mkdir(join(path, '..'), { recursive: true });
                await writeFile(path, 'lnk');
            }
        },
        freeBytes: async () => 100 * 1024 ** 3,
        async readiness(dataRoot, release) {
            const report = await diagnose({ dataRoot, release, api: repoApi });
            const problems = report.checks
                .filter((c) => ['versions', 'database', 'api'].includes(c.id))
                .filter((c) => c.status !== 'ok')
                .map((c) => `${c.id}: ${c.summary}`);
            return { ok: !problems.length, problems };
        },
        apiDir: () => repoApi,
        backupBinaries: () => ({ mongod, tools, api: repoApi }),
        async registered() {
            return readRegistered();
        },
        async running(name) {
            return Boolean(await pidOf(name));
        },
        async stopAll() {
            for (const name of [SERVICES.api, SERVICES.mongo]) {
                const pid = await pidOf(name);
                if (!pid) continue;
                process.kill(pid, 'SIGTERM');
                await boundedWait(async () => !alive(pid), {
                    timeoutMs: 60_000,
                    intervalMs: 200,
                }).catch(() => process.kill(pid, 'SIGKILL'));
            }
        },
    };
    return ctx;
}

export { once };
