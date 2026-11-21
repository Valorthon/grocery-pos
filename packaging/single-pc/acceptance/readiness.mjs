#!/usr/bin/env node
/**
 * Release-readiness checker (#366). Fails when a required operator document,
 * shipped tool, license notice or runbook scenario is missing, and, with
 * --bundle, verifies a built bundle against its out-of-band manifest hash,
 * the release file list and the pinned components.
 *
 *   node readiness.mjs [--bundle <dir> --manifest-sha256 <hex>] [--caddy <bin>] [--json]
 *
 * The Caddy configs are always checked for unquoted path placeholders. With
 * --caddy (any caddy of the pinned version), or with --bundle on Windows
 * (its own caddy.exe), Caddyfile and Caddyfile.lan are also adapted for
 * real with a client root containing a space, as under C:\Program Files.
 *
 * Exit 0 ready, 1 not ready, 2 usage. Passing is a precondition for a
 * release, not acceptance: the Windows 11 runbook still has to be executed.
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { MANUAL } from './acceptance.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
export const SINGLE_PC = resolve(here, '..');

/** Documents a release needs, with text each must contain. */
export const REQUIRED_DOCS = Object.freeze({
    'acceptance/RUNBOOK.md': ['Not yet executed', 'Sign-off'],
    'operations/INSTALL.md': [
        '-Mode install',
        '-ManifestSha256',
        'handover-done',
    ],
    'operations/MAINTENANCE.md': [
        'Close every Grocery POS tab',
        'shifts',
        'pending',
        '30-minute',
        'upgrade-status',
    ],
    'operations/REPLACEMENT-PC.md': ['-Mode restore', '-Confirm', 'export'],
    'operations/HANDOVER.md': [
        'Back up to USB drive',
        'Check Grocery POS',
        'Change password',
        'belong to the owner',
    ],
    'diagnostics/RECOVERY.md': ['re-run the same restore'],
    'installer/README.md': [],
    'backup/README.md': [],
    'upgrade/README.md': [],
    'runtime/README.md': [],
    'ARCHITECTURE.md': [],
    'proof/ACCEPTANCE-CHECKLIST.md': ['RUNBOOK.md'],
});

/** Every scenario the runbook must define (A/B kept from the checklist). */
export const SCENARIOS = Object.freeze([
    ...['A1', 'A2', 'A3', 'A4', 'A5', 'A6'],
    ...Array.from({ length: 17 }, (_, i) => `B${i + 1}`),
    ...['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'R1'],
    ...Array.from({ length: 13 }, (_, i) => `D${i + 1}`),
]);

/** Source tools the bundle copies (bundle.mjs TOOL_DIRS / REQUIRED_RELEASE_FILES). */
export const REQUIRED_TOOLS = Object.freeze([
    'installer/Install.ps1',
    'installer/install.mjs',
    'installer/bundle.mjs',
    'installer/Launch.ps1',
    'installer/BackupToUsb.ps1',
    'installer/CheckHealth.ps1',
    'installer/ExportReminder.ps1',
    'installer/terminal.mjs',
    'installer/JoinTerminal.ps1',
    'installer/MakeTerminalPackage.ps1',
    'runtime/provision.mjs',
    'backup/backup.mjs',
    'backup/restore.mjs',
    'diagnostics/diagnose.mjs',
    'upgrade/upgrade.mjs',
    'upgrade/migrations.mjs',
    'proof/run.mjs',
    'acceptance/acceptance.mjs',
    'acceptance/Acceptance.ps1',
]);

async function exists(p) {
    return Boolean(await stat(p).catch(() => undefined));
}

/** The runbook defines a scenario as a `### <id>.` heading or a table row
 *  `| <id> |`, and each needs a result field. */
export function runbookProblems(text) {
    const problems = [];
    for (const id of SCENARIOS) {
        const heading = new RegExp(`^#{2,3}\\s+${id}\\.`, 'm');
        const row = new RegExp(`^\\|\\s*${id}\\s*\\|`, 'm');
        if (!heading.test(text) && !row.test(text))
            problems.push(`runbook: scenario ${id} missing`);
    }
    for (const { id } of MANUAL)
        if (!SCENARIOS.includes(id))
            problems.push(`harness: manual ${id} not a runbook scenario`);
    if (/(Result[^\n|]*?:\s*|\|\s*)\**`?\**(PASS|FAIL)\b(?!\/)/i.test(text)) {
        // A filled result in the template means someone committed evidence.
        problems.push(
            'runbook: contains a recorded PASS/FAIL result; keep the template blank',
        );
    }
    return problems;
}

export function componentProblems(components) {
    const problems = [];
    for (const [key, c] of Object.entries(components)) {
        if (!c || typeof c !== 'object' || !c.version) continue;
        if (!c.license) problems.push(`components: ${key} has no license`);
        if (c.bundle) {
            if (!/^[0-9a-f]{64}$/.test(c.sha256 ?? ''))
                problems.push(`components: ${key} sha256 not pinned`);
            if (!/^https:\/\//.test(c.url ?? ''))
                problems.push(`components: ${key} url not https`);
        }
    }
    return problems;
}

export async function sourceProblems(root = SINGLE_PC) {
    const problems = [];
    for (const [doc, needles] of Object.entries(REQUIRED_DOCS)) {
        const text = await readFile(join(root, doc), 'utf8').catch(
            () => undefined,
        );
        if (text === undefined) {
            problems.push(`doc missing: ${doc}`);
            continue;
        }
        for (const needle of needles)
            if (!text.includes(needle))
                problems.push(`doc ${doc}: must mention "${needle}"`);
        if (doc === 'acceptance/RUNBOOK.md')
            problems.push(...runbookProblems(text));
    }
    for (const tool of REQUIRED_TOOLS)
        if (!(await exists(join(root, tool))))
            problems.push(`tool missing: ${tool}`);
    const components = JSON.parse(
        await readFile(join(root, 'components.json'), 'utf8'),
    );
    problems.push(...componentProblems(components));
    return problems;
}

export async function bundleProblems(bundle, manifestSha256, root = SINGLE_PC) {
    const { readBundle } = await import('../installer/install.mjs');
    const { REQUIRED_RELEASE_FILES, bundledComponents } =
        await import('../installer/bundle.mjs');
    const problems = [];
    let manifest;
    try {
        ({ manifest } = await readBundle(bundle, {
            manifest: join(bundle, 'bundle-manifest.json'),
            manifestSha256,
        }));
    } catch (error) {
        return [`bundle: ${error.message}`];
    }
    for (const f of REQUIRED_RELEASE_FILES)
        if (!manifest.files[`release/${f}`])
            problems.push(`bundle: release/${f} missing`);
    for (const f of ['Install.ps1', 'README.txt'])
        if (!manifest.files[f]) problems.push(`bundle: ${f} missing`);
    const components = JSON.parse(
        await readFile(join(root, 'components.json'), 'utf8'),
    );
    const notice = await readFile(
        join(bundle, 'release', 'notices', 'COMPONENTS.md'),
        'utf8',
    ).catch(() => '');
    for (const c of bundledComponents(components)) {
        if (manifest.components?.[c.key]?.sha256 !== c.sha256)
            problems.push(`bundle: ${c.key} is not the pinned archive`);
        if (!notice.includes(c.version))
            problems.push(
                `bundle: COMPONENTS.md does not name ${c.key} ${c.version}`,
            );
    }
    if (!/SSPL/.test(notice))
        problems.push('bundle: COMPONENTS.md lacks the MongoDB SSPL notice');
    if (manifest.platform !== 'win32-x64')
        problems.push(`bundle: platform ${manifest.platform}`);
    return problems;
}

/** Env placeholders that are always one token (an IPv4 address); every other
 *  `{$VAR}` / `{env.VAR}` may hold a Windows path with spaces. */
const SPACE_FREE_PLACEHOLDERS = new Set(['GPOS_LAN_IP']);
export const CADDY_CONFIGS = Object.freeze([
    'app.caddy',
    'Caddyfile',
    'Caddyfile.lan',
]);

/** Unquoted path placeholders in a Caddy config: `{$X}` is substituted before
 *  tokenizing, so a space in the value splits the argument. */
export function caddyQuotingProblems(name, text) {
    const problems = [];
    text.split(/\r?\n/).forEach((line, i) => {
        const code = line.replace(/(^|\s)#.*$/, '');
        const unquoted = code.replace(/"(?:[^"\\]|\\.)*"/g, '""');
        for (const m of unquoted.matchAll(
            /\{(?:\$|env\.)([A-Za-z0-9_]+)(?::[^}]*)?\}/g,
        ))
            if (!SPACE_FREE_PLACEHOLDERS.has(m[1]))
                problems.push(
                    `caddy: ${name}:${i + 1} has unquoted {${m[0].slice(1, -1)}}; quote it (a path with spaces splits)`,
                );
    });
    return problems;
}

export async function caddySourceProblems(root = SINGLE_PC) {
    const problems = [];
    for (const name of CADDY_CONFIGS)
        problems.push(
            ...caddyQuotingProblems(
                name,
                await readFile(join(root, 'caddy', name), 'utf8'),
            ),
        );
    return problems;
}

/** `caddy adapt` on both service configs with spaced paths. `configDir` holds
 *  Caddyfile, Caddyfile.lan and app.caddy (the repo's or a release's). */
export async function caddyAdaptProblems(
    caddy,
    configDir,
    run = promisify(execFile),
) {
    const work = await mkdtemp(join(tmpdir(), 'gpos readiness '));
    const problems = [];
    try {
        const client = join(work, 'Program Files', 'client');
        await mkdir(client, { recursive: true });
        const env = {
            ...process.env,
            GPOS_CLIENT_ROOT: client,
            GPOS_LAN_IP: '192.168.1.10',
            XDG_DATA_HOME: join(work, 'data dir'),
            XDG_CONFIG_HOME: join(work, 'config dir'),
            AppData: join(work, 'app data'),
        };
        for (const file of ['Caddyfile', 'Caddyfile.lan']) {
            try {
                const { stdout } = await run(
                    caddy,
                    [
                        'adapt',
                        '--config',
                        join(configDir, file),
                        '--adapter',
                        'caddyfile',
                    ],
                    { env, cwd: configDir, maxBuffer: 1 << 24 },
                );
                if (!stdout.includes(JSON.stringify(client).slice(1, -1)))
                    problems.push(
                        `caddy: ${file} adapted without the spaced client root`,
                    );
            } catch (error) {
                const detail =
                    `${error.stderr ?? ''}`.trim().split(/\r?\n/).pop() ||
                    error.message;
                problems.push(
                    `caddy: adapt ${file} with a spaced path failed: ${detail}`,
                );
            }
        }
    } finally {
        await rm(work, { recursive: true, force: true });
    }
    return problems;
}

export function parseArgs(args) {
    const out = {};
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--json') out.json = true;
        else if (
            a === '--bundle' ||
            a === '--manifest-sha256' ||
            a === '--caddy'
        ) {
            const v = args[++i];
            if (v === undefined || v.startsWith('--'))
                throw new Error(`${a} needs a value.`);
            out[
                {
                    '--bundle': 'bundle',
                    '--manifest-sha256': 'manifestSha256',
                    '--caddy': 'caddy',
                }[a]
            ] = v;
        } else throw new Error(`Unknown option ${a}.`);
    }
    if (Boolean(out.bundle) !== Boolean(out.manifestSha256))
        throw new Error('--bundle and --manifest-sha256 go together.');
    if (out.manifestSha256 && !/^[0-9a-f]{64}$/i.test(out.manifestSha256))
        throw new Error('--manifest-sha256 must be 64 hex characters.');
    if (out.bundle) out.bundle = resolve(out.bundle);
    if (out.caddy) out.caddy = resolve(out.caddy);
    return out;
}

export async function main(
    argv,
    print = (l) => process.stdout.write(`${l}\n`),
) {
    let options;
    try {
        options = parseArgs(argv);
    } catch (error) {
        print(`Usage: ${error.message}`);
        return 2;
    }
    const problems = await sourceProblems();
    problems.push(...(await caddySourceProblems()));
    if (options.bundle)
        problems.push(
            ...(await bundleProblems(options.bundle, options.manifestSha256)),
        );
    // A real adapt: the given caddy on the repo's configs, else (Windows only)
    // the bundle's own caddy.exe on the bundle's configs.
    let caddyAdapted = false;
    if (options.caddy) {
        problems.push(
            ...(await caddyAdaptProblems(
                options.caddy,
                join(SINGLE_PC, 'caddy'),
            )),
        );
        caddyAdapted = true;
    } else if (options.bundle && process.platform === 'win32') {
        const dir = join(options.bundle, 'release', 'caddy');
        problems.push(
            ...(await caddyAdaptProblems(join(dir, 'caddy.exe'), dir)),
        );
        caddyAdapted = true;
    }
    if (options.json)
        print(
            JSON.stringify(
                {
                    ready: problems.length === 0,
                    bundleChecked: Boolean(options.bundle),
                    caddyAdapted,
                    problems,
                },
                null,
                2,
            ),
        );
    else {
        for (const p of problems) print(`NOT READY: ${p}`);
        print(
            problems.length
                ? `${problems.length} problem(s).`
                : `Ready${options.bundle ? ' (bundle verified)' : ''}${caddyAdapted ? ' (Caddy configs adapted with spaced paths)' : ''}. Windows 11 acceptance (RUNBOOK.md) is still required.`,
        );
    }
    return problems.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    process.exit(await main(process.argv.slice(2)));
}
