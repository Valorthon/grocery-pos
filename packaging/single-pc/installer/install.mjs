// Single-PC installer, repair and uninstall (#362). Run by Install.ps1 with
// the bundle's own node.exe, elevated:
//
//   node install.mjs install   --bundle <dir> --admin-username <name>
//                              [--store-timezone <IANA>] [--backup-time HH:MM]
//   node install.mjs repair    --bundle <dir> [--backup-time HH:MM]
//   node install.mjs uninstall [--remove-ca-trust]
//   node install.mjs handover-done
//
// Exit codes: 0 done, 1 failed (re-run resumes), 2 usage, 3 refused
// (nothing changed). Every stage is idempotent and journaled in the data
// root's state\installer.json; replaceable binaries live under
// %ProgramFiles%, everything persistent under %ProgramData% (README.md).
import { execFile } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import {
    cp,
    mkdir,
    readFile,
    readdir,
    rename,
    rm,
    rmdir,
    stat,
    statfs,
    writeFile,
} from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { connect as netConnect } from 'node:net';
import { release as osRelease } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { boundedWait } from '../proof/policy.mjs';
import { acquireLock, provision, releaseLock } from '../runtime/provision.mjs';
import {
    LOOPBACK,
    PORTS,
    SERVICES,
    layout,
    releaseLayout,
    serviceDefinitions,
} from '../runtime/layout.mjs';
import { MANIFEST, verifyTree } from './bundle.mjs';
import {
    DEFAULT_BACKUP_TIME,
    HANDOVER_FILE,
    HANDOVER_NOTE,
    INSTALLER_STATE_SCHEMA,
    PRODUCT,
    TASKS,
    aclSteps,
    backupTaskXml,
    caddyRootCertificate,
    evaluatePreflight,
    handoverAclSteps,
    locations,
    parseTime,
    reminderTaskXml,
    serviceSteps,
    shortcutSpec,
    stopOrder,
    trustSteps,
    uninstallSteps,
    untrustSteps,
} from './plan.mjs';

export const EXIT = { OK: 0, FAILED: 1, USAGE: 2, REFUSED: 3 };
export const MODES = Object.freeze([
    'install',
    'repair',
    'uninstall',
    'handover-done',
]);

export class RefusedError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RefusedError';
    }
}

export function parseArgs(argv) {
    const [mode, ...args] = argv;
    if (!MODES.includes(mode)) {
        throw new Error(`The first argument is one of: ${MODES.join(', ')}.`);
    }
    const allowed = {
        install: ['bundle', 'admin-username', 'store-timezone', 'backup-time'],
        repair: ['bundle', 'backup-time'],
        uninstall: ['remove-ca-trust'],
        'handover-done': [],
    }[mode];
    const flags = new Set(['remove-ca-trust']);
    const out = { mode };
    for (let i = 0; i < args.length; i++) {
        const name = args[i].startsWith('--') ? args[i].slice(2) : '';
        if (!allowed.includes(name)) {
            throw new Error(`Unknown option ${args[i]} for ${mode}.`);
        }
        const key = name.replace(/-(\w)/g, (_, c) => c.toUpperCase());
        if (Object.hasOwn(out, key)) throw new Error(`--${name} given twice.`);
        if (flags.has(name)) {
            out[key] = true;
            continue;
        }
        const value = args[++i];
        if (value === undefined || value.startsWith('--')) {
            throw new Error(`--${name} needs a value.`);
        }
        out[key] = value;
    }
    if ((mode === 'install' || mode === 'repair') && !out.bundle) {
        throw new Error('--bundle is required.');
    }
    if (out.backupTime !== undefined)
        out.backupTime = parseTime(out.backupTime);
    if (
        out.adminUsername !== undefined &&
        !/^\S{1,64}$/.test(out.adminUsername)
    ) {
        throw new Error('--admin-username must be one word.');
    }
    return out;
}

// ------------------------------------------------------------ bundle

/** Reads the bundle manifest and verifies every release file. */
export async function readBundle(bundleDir) {
    const dir = resolve(bundleDir);
    const manifest = JSON.parse(
        await readFile(join(dir, MANIFEST), 'utf8').catch(() => {
            throw new RefusedError('This folder is not a Grocery POS bundle.');
        }),
    );
    if (!/^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/.test(manifest.version ?? '')) {
        throw new RefusedError('The bundle manifest has no valid version.');
    }
    const problems = await verifyTree(
        join(dir, 'release'),
        manifest.files,
        'release/',
    );
    if (problems.length) {
        throw new RefusedError(
            `The bundle is damaged or modified (${problems.slice(0, 5).join('; ')}). Rebuild or recopy it.`,
        );
    }
    const releaseBytes = Object.keys(manifest.files).length
        ? await sizeOf(join(dir, 'release'))
        : 0;
    return { dir, manifest, releaseBytes };
}

async function sizeOf(dir) {
    let total = 0;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        total += entry.isDirectory()
            ? await sizeOf(full)
            : (await stat(full)).size;
    }
    return total;
}

/**
 * Puts the verified release at releases\<version>. A complete, unchanged
 * copy is kept; a damaged one is moved aside and replaced; a copy is made
 * beside it first and renamed, so an interruption never leaves a partial
 * release under the real name.
 */
export async function placeRelease(bundle, releasesDir, log, now = new Date()) {
    const target = join(releasesDir, bundle.manifest.version);
    const files = bundle.manifest.files;
    if (await exists(target)) {
        const problems = await verifyTree(target, files, 'release/');
        if (!problems.length) {
            log(`release: ${bundle.manifest.version} already in place`);
            return target;
        }
        const aside = `${target}.damaged-${now.getTime()}`;
        log(
            `release: existing copy differs (${problems.length} files); moving it aside`,
        );
        await rename(target, aside);
    }
    const partial = `${target}.partial`;
    await rm(partial, { recursive: true, force: true });
    await mkdir(releasesDir, { recursive: true });
    await cp(join(bundle.dir, 'release'), partial, { recursive: true });
    const problems = await verifyTree(partial, files, 'release/');
    if (problems.length) {
        throw new Error(`Copied release failed verification: ${problems[0]}`);
    }
    await rename(partial, target);
    log(`release: ${bundle.manifest.version} installed`);
    return target;
}

async function exists(path) {
    return Boolean(await stat(path).catch(() => undefined));
}

// ------------------------------------------------------------ state

/** absent/empty → 'new'; our install.json → 'ours'; anything else 'foreign'. */
export async function classifyDataRoot(root) {
    const entries = await readdir(root).catch((error) => {
        if (error.code === 'ENOENT') return [];
        throw error;
    });
    if (entries.length === 0) return 'new';
    return (await exists(layout(root).install)) ? 'ours' : 'foreign';
}

function statePath(paths) {
    return join(paths.dirs.state, 'installer.json');
}

async function readState(paths) {
    return JSON.parse(
        await readFile(statePath(paths), 'utf8').catch(() => 'null'),
    );
}

async function writeState(paths, state) {
    const path = statePath(paths);
    await writeFile(`${path}.tmp`, JSON.stringify(state, null, 2) + '\n', {
        mode: 0o600,
    });
    await rename(`${path}.tmp`, path);
}

// ------------------------------------------------------------ steps

/** Runs plan steps through the context (exec/copy/write/remove/stop). */
export async function runSteps(steps, ctx) {
    for (const step of steps) {
        if (step.kind === 'exec') {
            const { code } = await ctx.exec(step.file, step.args);
            if (code !== 0 && !step.allowFailure) {
                throw new Error(
                    `${step.file} ${step.args[0] ?? ''} failed (exit ${code}).`,
                );
            }
        } else if (step.kind === 'copy') {
            await cp(step.from, step.to);
        } else if (step.kind === 'write') {
            await mkdir(dirname(step.path), { recursive: true });
            await writeFile(step.path, step.text);
        } else if (step.kind === 'remove') {
            await rm(step.path, { force: true });
        } else if (step.kind === 'stop') {
            await ctx.stopService(step.name);
        } else {
            throw new Error(`Unknown step ${step.kind}.`);
        }
    }
}

/** Task Scheduler XML must be UTF-16 (LE, with BOM) to match its header. */
export function utf16(text) {
    return Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from(text, 'utf16le'),
    ]);
}

function handoverNote(username) {
    return [
        `${PRODUCT}: first administrator`,
        '',
        `Username: ${username}`,
        `Temporary password: in ${HANDOVER_FILE} in this folder.`,
        '',
        'Give both to the store owner in person. At the first login Grocery POS',
        'asks for a new password; the temporary one stops working after that.',
        'Only administrators of this PC can open this folder.',
        '',
        'After the owner has logged in and changed the password, delete this',
        'folder by running, as an administrator, from the installation bundle:',
        '    Install.ps1 -Mode handover-done',
        '',
    ].join('\r\n');
}

// ------------------------------------------------------------ modes

async function installOrRepair(options, ctx, log) {
    const loc = ctx.locations;
    const bundle = await readBundle(options.bundle);
    const dataState = await classifyDataRoot(loc.dataRoot);
    const facts = await ctx.facts({ loc, bundle, dataState });
    const { refusals, warnings } = evaluatePreflight(
        { ...facts, dataRoot: dataState, releaseBytes: bundle.releaseBytes },
        options.mode,
    );
    for (const warning of warnings) log(`warning: ${warning}`);
    if (refusals.length) throw new RefusedError(refusals.join(' '));

    await mkdir(loc.programDir, { recursive: true });
    let token;
    try {
        token = await acquireLock(loc.lock);
    } catch (error) {
        throw new RefusedError(
            `Another installer run is active (${error.message})`,
        );
    }
    try {
        const paths = layout(loc.dataRoot);
        const previous = dataState === 'ours' ? await readState(paths) : null;
        const adminUsername = options.adminUsername ?? previous?.adminUsername;
        if (!adminUsername && options.mode === 'install') {
            throw new RefusedError(
                '--admin-username is required for a new installation.',
            );
        }

        // Replace binaries and re-register only with everything stopped.
        for (const name of stopOrder()) {
            if (facts.servicesInstalled.includes(name))
                await ctx.stopService(name);
        }

        const release = await placeRelease(bundle, loc.releasesDir, log);
        const bin = releaseLayout(release, { windows: ctx.windows });
        const stages = {};
        const done = async (stage) => {
            stages[stage] = new Date().toISOString();
            await writeState(paths, {
                schema: INSTALLER_STATE_SCHEMA,
                version: bundle.manifest.version,
                release,
                adminUsername,
                backupTime:
                    options.backupTime ??
                    previous?.backupTime ??
                    DEFAULT_BACKUP_TIME,
                stages,
                complete: false,
            });
        };

        log('provision: database, secrets and configuration');
        await ctx.provision({
            dataRoot: loc.dataRoot,
            mongod: bin.mongod,
            api: bin.api,
            ...(options.storeTimezone
                ? { storeTimezone: options.storeTimezone }
                : {}),
        });
        await done('release');
        await done('provision');

        log('services: registering MongoDB, API and proxy');
        for (const name of stopOrder()) {
            if (facts.servicesInstalled.includes(name)) {
                await runSteps(
                    [{ kind: 'exec', file: 'sc.exe', args: ['delete', name] }],
                    ctx,
                );
            }
        }
        await runSteps(
            serviceSteps(paths, release, join(loc.programDir, 'services')),
            ctx,
        );
        await runSteps(aclSteps(paths, release), ctx);
        for (const def of serviceDefinitions(paths, release)) {
            await ctx.startService(def.name);
            await ctx.waitReady(def.name, paths);
        }
        await done('services');

        log('trust: local certificate authority for Chrome');
        await ctx.waitFile(caddyRootCertificate(paths));
        await runSteps(trustSteps(paths), ctx);
        await ctx.waitReady(SERVICES.proxy, paths, { trusted: true });
        await done('trust');

        log('admin: first administrator');
        await mkdir(loc.handoverDir, { recursive: true });
        await runSteps(handoverAclSteps(loc.handoverDir), ctx);
        const handover = join(loc.handoverDir, HANDOVER_FILE);
        const haveFile = await exists(handover);
        const { code } = await ctx.exec(bin.node, [
            `--env-file=${paths.apiEnv}`,
            bin.initialAdmin,
            '--username',
            adminUsername,
            // An earlier interrupted run's file is reused, never replaced.
            haveFile ? '--password-file' : '--generate-password-file',
            handover,
        ]);
        if (code === 0) {
            await writeFile(
                join(loc.handoverDir, HANDOVER_NOTE),
                handoverNote(adminUsername),
            );
            log(`admin: created; hand over the folder ${loc.handoverDir}`);
        } else if (code === 3) {
            log('admin: this database already has its first administrator');
        } else {
            throw new Error(
                `The first-administrator command failed (exit ${code}).`,
            );
        }
        await done('admin');

        log('tasks: daily backup and weekly export reminder');
        const taskDir = join(loc.programDir, 'tasks');
        await mkdir(taskDir, { recursive: true });
        const xmlPaths = {
            backup: join(taskDir, 'daily-backup.xml'),
            exportReminder: join(taskDir, 'weekly-export-reminder.xml'),
        };
        await writeFile(
            xmlPaths.backup,
            utf16(
                backupTaskXml(
                    paths,
                    release,
                    options.backupTime ??
                        previous?.backupTime ??
                        DEFAULT_BACKUP_TIME,
                ),
            ),
        );
        await writeFile(
            xmlPaths.exportReminder,
            utf16(reminderTaskXml(release)),
        );
        for (const [key, name] of Object.entries(TASKS)) {
            await runSteps(
                [
                    {
                        kind: 'exec',
                        file: 'schtasks.exe',
                        args: [
                            '/Create',
                            '/TN',
                            name,
                            '/XML',
                            xmlPaths[key],
                            '/F',
                        ],
                    },
                ],
                ctx,
            );
        }
        await done('tasks');

        log('shortcut: desktop and Start menu');
        await ctx.createShortcuts(loc.shortcuts, shortcutSpec(release));
        await done('shortcut');

        const state = await readState(paths);
        await writeState(paths, { ...state, complete: true });
        return {
            mode: options.mode,
            version: bundle.manifest.version,
            release,
            dataRoot: loc.dataRoot,
            handover: (await exists(handover)) ? loc.handoverDir : null,
            warnings,
        };
    } finally {
        await releaseLock(loc.lock, token);
    }
}

async function uninstall(options, ctx, log) {
    const loc = ctx.locations;
    const facts = await ctx.facts({ loc, dataState: 'unknown' });
    const { refusals } = evaluatePreflight(facts, 'uninstall');
    if (refusals.length) throw new RefusedError(refusals.join(' '));
    await mkdir(loc.programDir, { recursive: true });
    const token = await acquireLock(loc.lock).catch((error) => {
        throw new RefusedError(
            `Another installer run is active (${error.message})`,
        );
    });
    try {
        await runSteps(
            uninstallSteps({
                installedServices: facts.servicesInstalled,
                shortcuts: loc.shortcuts,
            }),
            ctx,
        );
        if (options.removeCaTrust) {
            const cert = caddyRootCertificate(layout(loc.dataRoot));
            const pem = await readFile(cert).catch(() => undefined);
            if (pem) {
                const serial = new X509Certificate(pem).serialNumber;
                await runSteps(untrustSteps(serial), ctx);
                log('trust: local certificate authority removed');
            }
        }
        // Only our binaries: releases, service wrappers, task files.
        await rm(loc.releasesDir, { recursive: true, force: true });
        await rm(join(loc.programDir, 'tasks'), {
            recursive: true,
            force: true,
        });
        await rm(join(loc.programDir, 'services'), {
            recursive: true,
            force: true,
        });
        log(`kept: ${loc.dataRoot} (data, secrets, TLS, backups, logs)`);
        return {
            mode: 'uninstall',
            removedServices: facts.servicesInstalled,
            kept: [loc.dataRoot, loc.handoverDir],
        };
    } finally {
        await releaseLock(loc.lock, token);
        await rmdir(loc.programDir).catch(() => {});
    }
}

async function handoverDone(ctx, log) {
    const dir = ctx.locations.handoverDir;
    const entries = await readdir(dir).catch(() => undefined);
    if (entries === undefined) {
        log('handover: nothing to delete');
        return { mode: 'handover-done', deleted: false };
    }
    const unexpected = entries.filter(
        (e) => e !== HANDOVER_FILE && e !== HANDOVER_NOTE,
    );
    if (unexpected.length) {
        throw new RefusedError(
            `The handover folder holds other files (${unexpected.join(', ')}); nothing was deleted.`,
        );
    }
    await rm(dir, { recursive: true });
    log('handover: temporary password file deleted');
    return { mode: 'handover-done', deleted: true };
}

export async function runInstaller(options, ctx, log = () => {}) {
    if (options.mode === 'uninstall') return uninstall(options, ctx, log);
    if (options.mode === 'handover-done') return handoverDone(ctx, log);
    return installOrRepair(options, ctx, log);
}

// ------------------------------------------------------------ Windows context

function execCapture(file, args, options = {}) {
    return new Promise((done) => {
        execFile(
            file,
            args,
            { windowsHide: true, maxBuffer: 4 * 1024 * 1024, ...options },
            (error, stdout, stderr) => {
                done({
                    code: error
                        ? typeof error.code === 'number'
                            ? error.code
                            : 1
                        : 0,
                    stdout: String(stdout),
                    stderr: String(stderr),
                });
            },
        );
    });
}

function powershell(command, env = {}) {
    return execCapture(
        'powershell.exe',
        [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            command,
        ],
        { env: { ...process.env, ...env } },
    );
}

function portBusy(host, port) {
    return new Promise((done) => {
        const socket = netConnect({ host, port });
        socket.setTimeout(1000);
        socket.once('connect', () => (socket.destroy(), done(true)));
        socket.once('timeout', () => (socket.destroy(), done(false)));
        socket.once('error', () => done(false));
    });
}

async function freeBytes(path) {
    let current = path;
    for (;;) {
        const info = await statfs(current).catch(() => undefined);
        if (info) return info.bavail * info.bsize;
        const parent = dirname(current);
        if (parent === current) return undefined;
        current = parent;
    }
}

function httpsReady(url, ca) {
    return new Promise((done) => {
        const req = httpsRequest(
            url,
            { ...(ca ? { ca } : {}), timeout: 5000 },
            (res) => {
                res.resume();
                done(res.statusCode === 200);
            },
        );
        req.once('error', () => done(false));
        req.once('timeout', () => (req.destroy(), done(false)));
        req.end();
    });
}

/** The real Windows context. Unproven until the #357/#366 Windows run. */
export function windowsContext(env = process.env) {
    const loc = locations(env);
    const serviceState = async (name) => {
        const { code, stdout } = await execCapture('sc.exe', ['query', name]);
        if (code === 1060) return 'absent';
        const match = /STATE\s+:\s+\d+\s+(\w+)/.exec(stdout);
        return match ? match[1] : 'UNKNOWN';
    };
    return {
        windows: true,
        locations: loc,
        exec: (file, args) => execCapture(file, args),
        async facts({ loc: where = loc } = {}) {
            const arch = await powershell(
                '[System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture',
            );
            const type = await execCapture('reg.exe', [
                'query',
                'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion',
                '/v',
                'InstallationType',
            ]);
            const dotnet = await execCapture('reg.exe', [
                'query',
                'HKLM\\SOFTWARE\\Microsoft\\NET Framework Setup\\NDP\\v4\\Full',
                '/v',
                'Release',
            ]);
            const admin = await execCapture('net.exe', ['session']);
            const chrome = await execCapture('reg.exe', [
                'query',
                'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
            ]);
            const servicesInstalled = [];
            for (const name of Object.values(SERVICES)) {
                if ((await serviceState(name)) !== 'absent')
                    servicesInstalled.push(name);
            }
            const portsBusy = [];
            for (const port of Object.values(PORTS)) {
                if (
                    (await portBusy('127.0.0.1', port)) ||
                    (await portBusy('::1', port))
                ) {
                    portsBusy.push(port);
                }
            }
            return {
                platform: process.platform,
                osBuild: Number(osRelease().split('.')[2]),
                osArchitecture: arch.stdout.trim(),
                serverEdition: /Server/i.test(type.stdout),
                isAdmin: admin.code === 0,
                dotNetRelease: Number.parseInt(
                    /Release\s+REG_DWORD\s+(0x[0-9a-f]+)/i.exec(
                        dotnet.stdout,
                    )?.[1] ?? '0',
                    16,
                ),
                chrome: chrome.code === 0,
                servicesInstalled,
                portsBusy,
                freeBytes: {
                    program: await freeBytes(where.programDir),
                    data: await freeBytes(where.dataRoot),
                },
            };
        },
        provision: (options) =>
            provision(options, (line) => process.stdout.write(`  ${line}\n`)),
        async startService(name) {
            if ((await serviceState(name)) === 'RUNNING') return;
            const { code } = await execCapture('sc.exe', ['start', name]);
            if (code !== 0 && code !== 1056) {
                throw new Error(`Could not start ${name} (exit ${code}).`);
            }
        },
        async stopService(name) {
            const state = await serviceState(name);
            if (state === 'absent' || state === 'STOPPED') return;
            await execCapture('sc.exe', ['stop', name]);
            // mongod's own service shuts down cleanly on SCM stop; WinSW sends
            // Ctrl+C then waits its stop timeout. Never TerminateProcess.
            await boundedWait(
                async () => (await serviceState(name)) === 'STOPPED',
                {
                    timeoutMs: 120_000,
                    intervalMs: 1000,
                },
            );
        },
        async waitReady(name, paths, { trusted = false } = {}) {
            const check =
                name === SERVICES.mongo
                    ? () => portBusy(LOOPBACK, PORTS.mongo)
                    : name === SERVICES.api
                      ? async () => {
                            const res = await fetch(
                                `http://${LOOPBACK}:${PORTS.api}/v1/health/ready`,
                            ).catch(() => undefined);
                            return res?.ok === true;
                        }
                      : async () =>
                            httpsReady(
                                `https://localhost:${PORTS.proxy}/v1/health/ready`,
                                trusted
                                    ? undefined
                                    : await readFile(
                                          caddyRootCertificate(paths),
                                      ).catch(() => undefined),
                            );
            await boundedWait(check, { timeoutMs: 180_000, intervalMs: 1000 });
        },
        async waitFile(path) {
            await boundedWait(() => exists(path), {
                timeoutMs: 60_000,
                intervalMs: 500,
            });
        },
        async createShortcuts(targets, spec) {
            for (const path of targets) {
                await mkdir(dirname(path), { recursive: true });
                // Values pass as environment variables, never spliced into code.
                const { code } = await powershell(
                    '$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:GPOS_LNK);' +
                        '$s.TargetPath = $env:GPOS_TARGET; $s.Arguments = $env:GPOS_ARGS;' +
                        '$s.WorkingDirectory = $env:GPOS_WD; $s.Description = $env:GPOS_DESC;' +
                        '$s.IconLocation = $env:GPOS_ICON; $s.WindowStyle = 7; $s.Save()',
                    {
                        GPOS_LNK: path,
                        GPOS_TARGET: spec.target,
                        GPOS_ARGS: spec.arguments,
                        GPOS_WD: spec.workingDirectory,
                        GPOS_DESC: spec.description,
                        GPOS_ICON: spec.icon,
                    },
                );
                if (code !== 0)
                    throw new Error(`Could not create the shortcut ${path}.`);
            }
        },
    };
}

async function main() {
    let options;
    try {
        options = parseArgs(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        return EXIT.USAGE;
    }
    if (process.platform !== 'win32') {
        process.stderr.write(
            'Refused: the installer runs on Windows 11 only.\n',
        );
        return EXIT.REFUSED;
    }
    try {
        const result = await runInstaller(options, windowsContext(), (line) =>
            process.stdout.write(`${line}\n`),
        );
        process.stdout.write(`${JSON.stringify(result)}\n`);
        return EXIT.OK;
    } catch (error) {
        if (error?.name === 'RefusedError') {
            process.stderr.write(`Refused: ${error.message}\n`);
            return EXIT.REFUSED;
        }
        // Fixed text plus our own message: never a driver/OS message that
        // could quote a connection string.
        process.stderr.write(
            `Failed: ${error instanceof Error && !/mongodb(\+srv)?:\/\//.test(error.message) ? error.message : 'unexpected error'}. Nothing was removed; re-run to resume.\n`,
        );
        return EXIT.FAILED;
    }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    process.exit(await main());
}
