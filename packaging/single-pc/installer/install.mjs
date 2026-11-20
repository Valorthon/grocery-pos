// Single-PC installer, repair and uninstall (#362). Run by Install.ps1 with
// the bundle's own node.exe, elevated:
//
//   node install.mjs install   --bundle <dir> --admin-username <name>
//                              [--store-timezone <IANA>] [--backup-time HH:MM]
//                              [--lan-ip <IPv4>|none]
//   node install.mjs repair    --bundle <dir> [--backup-time HH:MM]
//                              [--lan-ip <IPv4>|none]
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
    APP_DATABASE,
    LAN_SERVICE,
    LOOPBACK,
    PORTS,
    SERVICES,
    lanOrigin,
    layout,
    parseLanIp,
    releaseLayout,
    serviceDefinitions,
} from '../runtime/layout.mjs';
import {
    connectRoot,
    mongoDriver,
    readRootPassword,
} from '../backup/backup.mjs';
import { sha256, verifyTree } from './bundle.mjs';
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
    firewallSteps,
    handoverAclSteps,
    locations,
    parseTime,
    reminderTaskXml,
    logRotationTaskXml,
    checkShortcutSpec,
    helpShortcutSpec,
    ownerGuideShortcutSpec,
    allShortcuts,
    serviceSteps,
    backupShortcutSpec,
    releasesToPrune,
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
        install: [
            'bundle',
            'manifest',
            'manifest-sha256',
            'admin-username',
            'store-timezone',
            'backup-time',
            'lan-ip',
        ],
        repair: [
            'bundle',
            'manifest',
            'manifest-sha256',
            'backup-time',
            'lan-ip',
        ],
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
    if (mode === 'install' || mode === 'repair') {
        for (const name of ['bundle', 'manifest', 'manifestSha256']) {
            if (!out[name])
                throw new Error(
                    `--${name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())} is required.`,
                );
        }
        if (!/^[0-9a-f]{64}$/i.test(out.manifestSha256)) {
            throw new Error('--manifest-sha256 must be a SHA-256 hash.');
        }
    }

    if (out.backupTime !== undefined)
        out.backupTime = parseTime(out.backupTime);
    // `none` turns LAN terminals off; absent keeps the current setting.
    if (out.lanIp !== undefined) out.lanIp = parseLanIp(out.lanIp);
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
/**
 * The manifest is never read from the (possibly user-writable) bundle
 * folder: Install.ps1 passes its own copy in the admin-only run folder and
 * the SHA-256 the vendor recorded, and this re-checks that pin. Every
 * release file is then verified against it here and again at the
 * destination after copying (`placeRelease`).
 */
export async function readBundle(
    bundleDir,
    { manifest: manifestPath, manifestSha256 },
) {
    const dir = resolve(bundleDir);
    const bytes = await readFile(manifestPath).catch(() => {
        throw new RefusedError('The verified bundle manifest is missing.');
    });
    if (sha256(bytes) !== String(manifestSha256).toLowerCase()) {
        throw new RefusedError(
            'The bundle manifest does not match the SHA-256 the vendor recorded.',
        );
    }
    const manifest = JSON.parse(bytes.toString('utf8'));
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
    return {
        dir,
        manifest,
        releaseBytes,
        manifestSha256: String(manifestSha256).toLowerCase(),
    };
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
        // An installed release re-registered by a rollback (#364) has no
        // source to copy from: refuse and leave it exactly where it is.
        if (bundle.installed) {
            throw new RefusedError(
                `The installed release ${bundle.manifest.version} no longer matches its recorded manifest (${problems.slice(0, 3).join('; ')}); it was left in place.`,
            );
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
        await rm(partial, { recursive: true, force: true });
        throw new RefusedError(
            `The release changed while it was copied (${problems[0]}); nothing was installed.`,
        );
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

/** The LAN IP this installation serves, or null (#396). */
async function readStoredLanIp(paths) {
    const state = await readState(paths);
    if (state && Object.hasOwn(state, 'lanIp')) return state.lanIp ?? null;
    const manifest = JSON.parse(
        await readFile(paths.runtimeManifest, 'utf8').catch(() => 'null'),
    );
    return manifest?.lanIp ?? null;
}

/** state\releases\<version>.json: a placed release's verified manifest. */
export function releaseRecordPath(paths, version) {
    return join(paths.dirs.state, 'releases', `${version}.json`);
}

async function writeReleaseRecord(paths, bundle) {
    const path = releaseRecordPath(paths, bundle.manifest.version);
    await mkdir(dirname(path), { recursive: true });
    const record = {
        version: bundle.manifest.version,
        manifestSha256: bundle.manifestSha256 ?? null,
        data: bundle.manifest.data ?? null,
        files: Object.fromEntries(
            Object.entries(bundle.manifest.files).filter(([f]) =>
                f.startsWith('release/'),
            ),
        ),
    };
    await writeFile(`${path}.tmp`, JSON.stringify(record) + '\n', {
        mode: 0o600,
    });
    await rename(`${path}.tmp`, path);
}

/** The recorded manifest of an installed release, or undefined. */
export async function readReleaseRecord(paths, version) {
    try {
        return JSON.parse(
            await readFile(releaseRecordPath(paths, version), 'utf8'),
        );
    } catch {
        return undefined;
    }
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
        } else if (step.kind === 'gone') {
            // `sc delete` only marks the service; re-registering before the
            // SCM removes it fails with 1072 (marked for deletion).
            await ctx.waitServiceGone(step.name);
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
    // The upgrade tool (#364) hands over a bundle it verified itself, or the
    // previous release it re-verified for a rollback.
    const bundle =
        options.verifiedBundle ??
        (await readBundle(options.bundle, {
            manifest: options.manifest,
            manifestSha256: options.manifestSha256,
        }));
    const dataState = await classifyDataRoot(loc.dataRoot);
    // LAN terminals (#396): the stored IP (installer state, else the runtime
    // manifest a restore brought) unless --lan-ip names another or `none`.
    const storedLanIp =
        dataState === 'ours'
            ? await readStoredLanIp(layout(loc.dataRoot))
            : null;
    const lanIp = options.lanIp !== undefined ? options.lanIp : storedLanIp;
    const facts = await ctx.facts({ loc, bundle, dataState, lanIp });
    const { refusals, warnings } = evaluatePreflight(
        {
            ...facts,
            lanIp,
            lanIpChanged: lanIp !== storedLanIp,
            dataRoot: dataState,
            releaseBytes: bundle.releaseBytes,
        },
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
        // Another version over an installation is an upgrade or a
        // rollback: data migrations and the pre-upgrade backup are the
        // upgrade tool's (#364), never a plain repair's.
        if (
            options.mode === 'repair' &&
            !options.verifiedBundle &&
            previous?.version &&
            previous.version !== bundle.manifest.version
        ) {
            throw new RefusedError(
                `This PC runs Grocery POS ${previous.version}; ${bundle.manifest.version} is installed with the upgrade tool (upgrade.mjs), not repair.`,
            );
        }
        const adminUsername = options.adminUsername ?? previous?.adminUsername;
        if (!adminUsername && options.mode === 'install') {
            throw new RefusedError(
                '--admin-username is required for a new installation.',
            );
        }

        // A new LAN IP is a new origin: each terminal's queued offline cash
        // and lease live in the old origin's browser storage, so the change
        // waits until no shift is open and no lease is active (#396, the
        // restore checks). Checked while the services still run, and again
        // once the proxy and API are stopped (mongod still up), so no shift
        // can open in between. Install over an existing data root cannot
        // check (its database is not running): it refuses the change.
        if (lanIp !== storedLanIp && dataState === 'ours') {
            if (options.mode !== 'repair')
                throw new RefusedError(
                    `This installation is set up for LAN IP ${storedLanIp ?? 'none'}. Install with that setting (omit -LanIp), then change it with -Mode repair -LanIp, which first checks that no shift is open and no offline lease is active.`,
                );
            const check = async () => {
                const found = await ctx.lanChangeBlockers(
                    paths,
                    previous?.release,
                );
                const blockers = [];
                if (found.openShifts)
                    blockers.push(`${found.openShifts} shift(s) are open`);
                if (found.activeLeases)
                    blockers.push(
                        `${found.activeLeases} terminal(s) hold offline cash leases`,
                    );
                return blockers;
            };
            const refuse = (blockers) =>
                new RefusedError(
                    `The LAN IP cannot change now: ${blockers.join('; ')}. Close every shift and synchronize every terminal first.`,
                );
            let blockers = await check();
            if (blockers.length) throw refuse(blockers);
            const front = [LAN_SERVICE, SERVICES.proxy, SERVICES.api].filter(
                (name) => facts.servicesInstalled.includes(name),
            );
            for (const name of front) await ctx.stopService(name);
            blockers = await check();
            if (blockers.length) {
                // Put the store back as it was before refusing.
                for (const name of [...front].reverse())
                    await ctx.startService(name);
                throw refuse(blockers);
            }
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
                lanIp,
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
            // A new database starts at this release's data version (#364).
            ...(bundle.manifest.data?.dataVersion
                ? { dataVersion: bundle.manifest.data.dataVersion }
                : {}),
            ...(options.storeTimezone
                ? { storeTimezone: options.storeTimezone }
                : {}),
            lanIp,
        });
        // The release's own verified manifest, kept for later rollbacks
        // (#364): an upgrade re-verifies the previous release against it.
        // After provisioning, so the data root is already ours.
        if (!bundle.installed) await writeReleaseRecord(paths, bundle);
        await done('release');
        await done('provision');

        log('services: registering MongoDB, API and proxy');
        for (const name of stopOrder()) {
            if (facts.servicesInstalled.includes(name)) {
                await runSteps(
                    [
                        {
                            kind: 'exec',
                            file: 'sc.exe',
                            args: ['delete', name],
                        },
                        { kind: 'gone', name },
                    ],
                    ctx,
                );
            }
        }
        // Without LAN terminals the LAN proxy's wrapper goes too (#396).
        if (!lanIp)
            for (const ext of ['exe', 'xml'])
                await rm(
                    join(loc.programDir, 'services', `${LAN_SERVICE}.${ext}`),
                    { force: true },
                );
        await runSteps(
            serviceSteps(paths, release, join(loc.programDir, 'services'), {
                lanIp,
            }),
            ctx,
        );
        await runSteps(aclSteps(paths, release, { lanIp }), ctx);
        await runSteps(firewallSteps(release, lanIp), ctx);
        for (const def of serviceDefinitions(paths, release, { lanIp })) {
            await ctx.startService(def.name);
            if (!def.optional) {
                await ctx.waitReady(def.name, paths);
                continue;
            }
            // The LAN proxy (#396) never holds up the installation: with the
            // LAN address absent it keeps retrying under SCM recovery and
            // only the terminals wait.
            try {
                if (!facts.lanIpPresent) throw new Error('address absent');
                await ctx.waitReady(def.name, paths, { lanIp });
            } catch {
                const note = `${def.name} is not answering on ${lanIp} yet; LAN terminals cannot connect until the address is back (it retries by itself).`;
                warnings.push(note);
                log(`warning: ${note}`);
            }
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
            logRotation: join(taskDir, 'nightly-log-rotation.xml'),
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
        await writeFile(
            xmlPaths.logRotation,
            utf16(
                logRotationTaskXml(
                    paths,
                    release,
                    options.backupTime ??
                        previous?.backupTime ??
                        DEFAULT_BACKUP_TIME,
                ),
            ),
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
        await ctx.createShortcuts(
            loc.backupShortcuts,
            backupShortcutSpec(paths, release),
        );
        await ctx.createShortcuts(
            loc.checkShortcuts,
            checkShortcutSpec(paths, release),
        );
        await ctx.createShortcuts(loc.helpShortcuts, helpShortcutSpec(release));
        await ctx.createShortcuts(
            loc.ownerGuideShortcuts,
            ownerGuideShortcutSpec(release),
        );
        await done('shortcut');

        // Disk use stays bounded: keep this release and the newest other.
        const entries = [];
        for (const name of await readdir(loc.releasesDir)) {
            const info = await stat(join(loc.releasesDir, name));
            entries.push({ name, mtimeMs: info.mtimeMs });
        }
        for (const name of releasesToPrune(entries, bundle.manifest.version)) {
            await rm(join(loc.releasesDir, name), {
                recursive: true,
                force: true,
            });
            await rm(releaseRecordPath(layout(loc.dataRoot), name), {
                force: true,
            });
            log(`release: removed old ${name}`);
        }

        const state = await readState(paths);
        await writeState(paths, { ...state, complete: true });
        return {
            mode: options.mode,
            version: bundle.manifest.version,
            release,
            dataRoot: loc.dataRoot,
            handover: (await exists(handover)) ? loc.handoverDir : null,
            lanOrigin: lanOrigin(lanIp),
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
                shortcuts: allShortcuts(loc),
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

// ------------------------------------------------------------ LAN address

/**
 * `Get-NetIPAddress` output for the LAN IP (#396): one line per adapter
 * holding it in the Preferred state (a Duplicate or Tentative address, an
 * IP conflict, is not present), each with that adapter's NetworkCategory.
 * Public on any adapter wins, so the warning is never hidden.
 */
export function parseLanAddress(stdout) {
    const categories = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('present|'))
        .map((line) => line.slice('present|'.length));
    return {
        lanIpPresent: categories.length > 0,
        lanIpMultiple: categories.length > 1,
        lanProfile: categories.includes('Public')
            ? 'Public'
            : (categories.find(Boolean) ?? undefined),
    };
}

export async function lanAddressFacts(lanIp) {
    const { stdout } = await powershell(
        'Get-NetIPAddress -AddressFamily IPv4 -IPAddress $env:GPOS_IP -AddressState Preferred -ErrorAction SilentlyContinue |' +
            ' ForEach-Object { $p = Get-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue;' +
            " 'present|' + [string]$p.NetworkCategory }",
        { GPOS_IP: lanIp },
    );
    return parseLanAddress(stdout);
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
        async facts({ loc: where = loc, lanIp = null } = {}) {
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
            for (const name of [...Object.values(SERVICES), LAN_SERVICE]) {
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
            // LAN terminals (#396): the IP must be on a local adapter; its
            // network profile decides whether the Private-only rule applies.
            const lan = lanIp
                ? await lanAddressFacts(lanIp)
                : { lanIpPresent: false };
            const { lanIpPresent, lanProfile, lanIpMultiple } = lan;
            const lanPortBusy =
                Boolean(lanIp) &&
                lanIpPresent &&
                (await portBusy(lanIp, PORTS.proxy));
            const checkOwners = [...portsBusy];
            if (lanPortBusy && !checkOwners.includes(PORTS.proxy))
                checkOwners.push(PORTS.proxy);
            // A busy port counts as ours only if every listener's image is
            // under our releases folder.
            const portsForeign = [];
            for (const port of checkOwners) {
                const { stdout } = await powershell(
                    'Get-NetTCPConnection -State Listen -LocalPort $env:GPOS_PORT -ErrorAction SilentlyContinue |' +
                        ' ForEach-Object { (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).Path }',
                    { GPOS_PORT: String(port) },
                );
                const owners = stdout.split(/\r?\n/).filter((l) => l.trim());
                const ours = (path) =>
                    path
                        .toLowerCase()
                        .startsWith(`${where.releasesDir.toLowerCase()}\\`);
                if (!owners.length || !owners.every(ours))
                    portsForeign.push(port);
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
                portsForeign,
                lanIpPresent,
                lanProfile,
                lanIpMultiple,
                lanPortForeign:
                    lanPortBusy && portsForeign.includes(PORTS.proxy),
                freeBytes: {
                    program: await freeBytes(where.programDir),
                    data: await freeBytes(where.dataRoot),
                },
            };
        },
        // Open shifts and active offline leases block a LAN IP change (#396).
        async lanChangeBlockers(paths, release) {
            if (!release)
                throw new RefusedError(
                    'The installed release is unknown, so open shifts and offline leases cannot be checked; the LAN IP was not changed.',
                );
            let root;
            try {
                root = await connectRoot(
                    mongoDriver(join(release, 'api')),
                    await readRootPassword(paths),
                );
                const db = root.db(APP_DATABASE);
                return {
                    openShifts: await db
                        .collection('shifts')
                        .countDocuments({ status: 'OPEN' }),
                    activeLeases: await db
                        .collection('offlineleases')
                        .countDocuments({ active: true }),
                };
            } catch (error) {
                if (error?.name === 'RefusedError') throw error;
                throw new RefusedError(
                    'The database is not running, so open shifts and offline leases cannot be checked; start Grocery POS and retry. The LAN IP was not changed.',
                );
            } finally {
                await root?.close().catch(() => {});
            }
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
        async waitServiceGone(name) {
            await boundedWait(
                async () => (await serviceState(name)) === 'absent',
                {
                    timeoutMs: 60_000,
                    intervalMs: 1000,
                },
            );
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
        async waitReady(name, paths, { trusted = false, lanIp } = {}) {
            const check =
                name === LAN_SERVICE
                    ? () => portBusy(lanIp, PORTS.proxy)
                    : name === SERVICES.mongo
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
