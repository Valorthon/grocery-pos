// Single-PC upgrade (#364): the vendor's manual, offline upgrade of an
// installed release during an agreed maintenance window. Run by Install.ps1
// (-Mode upgrade / upgrade-rollback / upgrade-status) from the new bundle's
// verified copy, elevated:
//
//   node upgrade.mjs upgrade  --bundle <dir> --manifest <verified copy> --manifest-sha256 <hex>
//   node upgrade.mjs rollback [--restore-backup <pre-upgrade backup id> [--accept-newer-sales]]
//   node upgrade.mjs status
//
// Stages (journaled in state\upgrade.json, each idempotent; re-running
// `upgrade` with the same bundle resumes, `rollback` goes back):
//   verify → preflight → stop → backup → place → migrate → switch → ready
// Nothing changes before `stop`. Until `migrate` changes data, any failure
// rolls the binaries back to the previous release automatically. Once a
// migration may have changed data, the previous release cannot run on it
// (the API's data-version gate refuses), so recovery is either finishing
// the upgrade (re-run) or `rollback --restore-backup <id>`, which restores
// the pre-upgrade backup through restore.mjs (its confirmation and
// loss refusals) and then rolls the binaries back. See README.md.
//
// Exit codes: 0 done, 1 failed (see `status`), 2 usage, 3 refused (nothing
// changed).
import { readFile, rename, statfs, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { boundedWait } from '../proof/policy.mjs';
import {
    APP_DATABASE,
    LAN_SERVICE,
    SERVICES,
    layout,
    releaseLayout,
} from '../runtime/layout.mjs';
import { acquireLock, releaseLock } from '../runtime/provision.mjs';
import {
    compareVersions,
    connectRoot,
    createBackup,
    mongoDriver,
    readRootPassword,
    readStatus,
    statusSummary,
} from '../backup/backup.mjs';
import { leaseRefusal, lossChecks, restore } from '../backup/restore.mjs';
import { verifyTree } from '../installer/bundle.mjs';
import {
    lanAddressFacts,
    readAvx,
    readReleaseRecord,
    placeRelease,
    readBundle,
    runInstaller,
    windowsContext,
} from '../installer/install.mjs';
import { MIN_FREE, avxPreflight, stopOrder } from '../installer/plan.mjs';
import { diagnose } from '../diagnostics/diagnose.mjs';
import {
    MIGRATIONS,
    migrationRefusals,
    dataCheckWarnings,
    pendingMigrations,
    validateRegistry,
    DATA_VERSION_COLLECTION,
    DATA_VERSION_ID,
    MIGRATION_COLLECTION,
    readDataVersion,
    runMigrations,
    setMarker,
} from './migrations.mjs';

export {
    DATA_VERSION_COLLECTION,
    DATA_VERSION_ID,
    MIGRATION_COLLECTION,
    readDataVersion,
    runMigrations,
};

export const EXIT = { OK: 0, FAILED: 1, USAGE: 2, REFUSED: 3 };
export const JOURNAL_SCHEMA = 1;
export const STAGES = Object.freeze([
    'verify',
    'preflight',
    'stop',
    'backup',
    'place',
    'migrate',
    'switch',
    'ready',
]);
/** Diagnostics checks that must be OK before an upgrade counts as done. */
export const READINESS_CHECKS = Object.freeze([
    'versions',
    'services',
    'database',
    'api',
    'proxy',
]);
export const READY_TIMEOUT_MS = 180_000;
/** Program files: the new release beside the kept previous one. */
export const PROGRAM_HEADROOM = 1.2;

export class RefusedError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RefusedError';
    }
}

const isRefusal = (error) => error?.name === 'RefusedError';

// ------------------------------------------------------------ arguments

export function parseArgs(argv) {
    const [command, ...args] = argv;
    const allowed = {
        upgrade: ['bundle', 'manifest', 'manifest-sha256'],
        rollback: ['restore-backup', 'accept-newer-sales'],
        status: [],
    }[command];
    if (!allowed)
        throw new Error(
            'The first argument is one of: upgrade, rollback, status.',
        );
    const flags = new Set(['accept-newer-sales']);
    const out = { command };
    for (let i = 0; i < args.length; i++) {
        const name = args[i].startsWith('--') ? args[i].slice(2) : '';
        if (!allowed.includes(name))
            throw new Error(`Unknown option ${args[i]} for ${command}.`);
        const key = name.replace(/-(\w)/g, (_, c) => c.toUpperCase());
        if (Object.hasOwn(out, key)) throw new Error(`--${name} given twice.`);
        if (flags.has(name)) {
            out[key] = true;
            continue;
        }
        const value = args[++i];
        if (value === undefined || value.startsWith('--'))
            throw new Error(`--${name} needs a value.`);
        out[key] = value;
    }
    if (command === 'upgrade') {
        for (const name of ['bundle', 'manifest', 'manifestSha256'])
            if (!out[name])
                throw new Error(
                    `--${name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())} is required.`,
                );
        if (!/^[0-9a-f]{64}$/i.test(out.manifestSha256))
            throw new Error('--manifest-sha256 must be a SHA-256 hash.');
    }
    if (out.acceptNewerSales && !out.restoreBackup)
        throw new Error(
            '--accept-newer-sales only goes with --restore-backup.',
        );
    return out;
}

// ------------------------------------------------------------ pure policy

/** A release's data compatibility; releases before #364 are version 1. */
export function releaseData(info) {
    return {
        dataVersion: info?.data?.dataVersion ?? 1,
        minUpgradeFromDataVersion: info?.data?.minUpgradeFromDataVersion ?? 1,
        migrations: info?.data?.migrations ?? [],
    };
}

const majorMinor = (v) =>
    String(v ?? '')
        .split('.')
        .slice(0, 2)
        .join('.');

/**
 * The upgrade decision from collected facts. `refusals` mean nothing may
 * change. Facts: `from`/`to` ({ version, appVersion, mongodb, data }),
 * `database` ({ dataVersion, state, fcv }), `openShifts`, `activeLeases`,
 * `backup` (statusSummary), `free` ({ program, data }), `releaseBytes`.
 */
export function evaluateUpgrade(facts) {
    const refusals = [];
    const { from, to } = facts;
    if (from.version === to.version)
        refusals.push(
            `Grocery POS ${to.version} is already installed; there is nothing to upgrade.`,
        );
    if (compareVersions(to.appVersion, from.appVersion) < 0)
        refusals.push(
            `The bundle (app ${to.appVersion}) is older than the installed app ${from.appVersion}; downgrades are not supported (restore a backup instead).`,
        );
    if (to.data.dataVersion < from.data.dataVersion)
        refusals.push(
            `The bundle reads data version ${to.data.dataVersion}, older than the installed ${from.data.dataVersion}; downgrades are not supported.`,
        );
    if (from.data.dataVersion < to.data.minUpgradeFromDataVersion)
        refusals.push(
            `The bundle upgrades data from version ${to.data.minUpgradeFromDataVersion}; this PC has ${from.data.dataVersion}. Install the intermediate release first.`,
        );
    if (majorMinor(from.mongodb) !== majorMinor(to.mongodb))
        refusals.push(
            `The bundle changes MongoDB ${from.mongodb} to ${to.mongodb}; this tool upgrades only within one MongoDB release series (the feature-compatibility procedure is not supported yet).`,
        );
    const db = facts.database;
    if (db) {
        if (db.fcv !== majorMinor(from.mongodb))
            refusals.push(
                `The database feature compatibility is ${db.fcv}, not ${majorMinor(from.mongodb)}; it must match the installed MongoDB before an upgrade.`,
            );
        if (db.state !== 'ready')
            refusals.push(
                'The database is marked as being upgraded; finish or roll back that upgrade first (upgrade.mjs status).',
            );
        else if (db.dataVersion !== from.data.dataVersion)
            refusals.push(
                `The database has data version ${db.dataVersion}, the installed release ${from.data.dataVersion}; they must match.`,
            );
    }
    if (facts.openShifts)
        refusals.push(
            `${facts.openShifts} shift(s) are open; every cashier closes their shift first.`,
        );
    if (facts.activeLeases)
        refusals.push(
            `${leaseRefusal(facts.activeLeases, facts.leaseTerminals)}; synchronize their pending cash sales and close those shifts first.`,
        );
    const backup = facts.backup;
    if (backup) {
        if (!backup.lastVerifiedSuccess)
            refusals.push(
                'There is no verified backup yet; run a backup (Back up to USB drive or backup.mjs create) first.',
            );
        else if (backup.backupOverdue)
            refusals.push(
                'The last verified backup is overdue; run a backup first and check why the daily backup did not run.',
            );
        if (
            backup.lastFailure &&
            (!backup.lastVerifiedSuccess ||
                Date.parse(backup.lastFailure.at) >
                    Date.parse(backup.lastVerifiedSuccess.at))
        )
            refusals.push(
                'The last backup failed; fix it and run a successful backup first.',
            );
    }
    const needProgram = Math.ceil((facts.releaseBytes ?? 0) * PROGRAM_HEADROOM);
    if (facts.free?.program !== undefined && facts.free.program < needProgram)
        refusals.push(
            `Not enough free disk space for the new release (${gib(needProgram)} needed).`,
        );
    if (facts.free?.data !== undefined && facts.free.data < MIN_FREE.dataBytes)
        refusals.push(
            `Not enough free disk space for data and the pre-upgrade backup (${gib(MIN_FREE.dataBytes)} needed).`,
        );
    return refusals;
}

function gib(bytes) {
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/**
 * What a failed or interrupted upgrade may do automatically. Before a
 * data-changing migration starts, the previous release can run on the data:
 * binary rollback. After, only finishing the upgrade or restoring the
 * pre-upgrade backup with explicit confirmation is safe.
 */
export function recoveryPlan(journal) {
    if (!journal || ['complete', 'rolled-back'].includes(journal.state))
        return { action: 'none' };
    if (!journal.stages?.stop && !journal.current) return { action: 'none' };
    if (journal.dataChanged)
        return {
            action: 'restore-required',
            backupId: journal.backupId ?? null,
        };
    return { action: 'binary-rollback' };
}

// ------------------------------------------------------------ journal

export function journalPath(paths) {
    return join(paths.dirs.state, 'upgrade.json');
}
function lockPath(paths) {
    return join(paths.dirs.state, 'upgrade.lock');
}

export async function readJournal(paths) {
    const text = await readFile(journalPath(paths), 'utf8').catch((error) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
    });
    return text === undefined ? undefined : JSON.parse(text);
}

async function writeJournal(paths, journal) {
    const path = journalPath(paths);
    const next = { ...journal, updatedAt: new Date().toISOString() };
    await writeFile(`${path}.tmp`, JSON.stringify(next, null, 2) + '\n', {
        mode: 0o600,
    });
    await rename(`${path}.tmp`, path);
    return next;
}

async function readJson(path) {
    return JSON.parse(await readFile(path, 'utf8'));
}

// ------------------------------------------------------------ database

async function withRoot(paths, apiDir, fn) {
    const root = await connectRoot(
        mongoDriver(apiDir),
        await readRootPassword(paths),
    );
    try {
        return await fn(root);
    } finally {
        await root.close().catch(() => {});
    }
}

async function databaseFacts(root) {
    const fcv = await root
        .db('admin')
        .command({ getParameter: 1, featureCompatibilityVersion: 1 });
    return {
        ...(await readDataVersion(root)),
        fcv: fcv.featureCompatibilityVersion?.version,
    };
}

// ------------------------------------------------------------ the run

/** The previous release as a bundle the installer re-registers (rollback). */
function previousBundle(journal) {
    return {
        // Already installed: placeRelease only re-verifies it, and refuses
        // (leaving it in place) if it changed; there is nothing to copy.
        installed: true,
        dir: journal.from.release,
        manifestSha256: journal.from.manifestSha256,
        manifest: {
            version: journal.from.version,
            files: journal.from.files,
            data: journal.from.dataInfo,
        },
        releaseBytes: 0,
    };
}

async function releaseInfo(release) {
    const info = await readJson(join(release, 'VERSION.json')).catch(
        () => undefined,
    );
    if (!info)
        throw new RefusedError(
            `The installed release ${release} has no readable VERSION.json; repair it first.`,
        );
    return info;
}

function describe(info, version) {
    return {
        version,
        appVersion: info.appVersion,
        mongodb: info.components?.mongodb?.version,
        data: releaseData(info),
    };
}

async function binaryRollback(paths, journal, ctx, log) {
    // Before any service is touched: the previous release must still be
    // exactly its recorded manifest.
    const damaged = await verifyTree(
        journal.from.release,
        journal.from.files,
        'release/',
    );
    if (damaged.length)
        throw new RefusedError(
            `The previous release ${journal.from.version} no longer matches its recorded manifest (${damaged.slice(0, 3).join('; ')}); it was left in place. Re-run the upgrade to finish it, or repair ${journal.from.version} from its bundle.`,
        );
    if (journal.markerTouched && !journal.dataChanged) {
        // Only steps that changed no data ran (or none yet): the previous
        // release's data version is still right, and its API's gate needs
        // the marker back in `ready` before it can start.
        await ctx.startService(SERVICES.mongo);
        await ctx.waitReady(SERVICES.mongo, paths);
        await withRoot(paths, ctx.apiDir(journal.from.release), (root) =>
            setMarker(root, {
                dataVersion: journal.from.dataVersion,
                state: 'ready',
                release: journal.from.version,
            }),
        );
        log(`rollback: data version reset to ${journal.from.dataVersion}`);
    }
    log(`rollback: re-registering ${journal.from.version}`);
    await runInstaller(
        {
            mode: 'repair',
            verifiedBundle: previousBundle(journal),
            backupTime: journal.backupTime,
        },
        ctx,
        (l) => log(`  ${l}`),
    );
}

async function holdServices(ctx) {
    // The LAN proxy (#396) only exists with a LAN IP; setStartMode skips an
    // absent service.
    for (const name of [LAN_SERVICE, SERVICES.proxy, SERVICES.api])
        await ctx.setStartMode(name, 'demand');
    for (const name of stopOrder())
        if (name !== SERVICES.mongo) await ctx.stopService(name);
}

async function releaseServices(ctx) {
    for (const name of [SERVICES.api, SERVICES.proxy, LAN_SERVICE])
        await ctx.setStartMode(name, 'auto');
}

/** The LAN proxy, when installed; its absence or a missing address is no
 *  reason to fail the store's own recovery (#396). */
async function startLanProxy(ctx) {
    await ctx.startService(LAN_SERVICE).catch(() => {});
}

/**
 * Upgrade, or resume an interrupted one with the same bundle. `ctx` is the
 * installer context plus `setStartMode`, `freeBytes`, `readiness`,
 * `apiDir`, `backupBinaries`, `migrations` (tests inject) and `fault`.
 */
export async function runUpgrade(options, ctx, log = () => {}) {
    const loc = ctx.locations;
    const paths = layout(loc.dataRoot);
    const fault = ctx.fault ?? (() => {});
    const migrations = ctx.migrations ?? MIGRATIONS;
    const timings = {};
    const t0 = Date.now();

    // verify: the new bundle against the vendor-recorded manifest hash.
    const bundle = await readBundle(options.bundle, {
        manifest: options.manifest,
        manifestSha256: options.manifestSha256,
    });
    const to = describe(bundle.manifest, bundle.manifest.version);
    // The registry is this tool's own (the bundle's tools\upgrade, which
    // Install.ps1 runs): it must be the one the manifest describes.
    try {
        validateRegistry(
            migrations,
            to.data.dataVersion,
            to.data.minUpgradeFromDataVersion,
        );
    } catch (error) {
        throw new RefusedError(
            `This upgrade tool does not belong to the bundle (${error.message}); run the bundle's own Install.ps1 -Mode upgrade.`,
        );
    }
    const shipped = to.data.migrations.map((m) => m.id).join(',');
    if (shipped !== migrations.map((m) => m.id).join(','))
        throw new RefusedError(
            'The bundle manifest and its migration registry disagree; rebuild the bundle.',
        );
    timings.verify = Date.now() - t0;

    let token;
    try {
        token = await acquireLock(lockPath(paths));
    } catch {
        throw new RefusedError('Another upgrade run is active.');
    }
    try {
        let journal = await readJournal(paths);
        const resuming =
            journal &&
            !['complete', 'rolled-back', 'refused'].includes(journal.state);
        if (resuming && journal.to.version !== to.version)
            throw new RefusedError(
                `An interrupted upgrade to ${journal.to.version} must be finished or rolled back first (upgrade.mjs status).`,
            );
        if (resuming && journal.state === 'rollback-failed')
            throw new RefusedError(
                'The last rollback did not finish; run upgrade.mjs rollback again.',
            );

        if (!resuming) {
            // preflight: read-only.
            const state = await readJson(
                join(paths.dirs.state, 'installer.json'),
            ).catch(() => undefined);
            if (!state?.complete || !state.release)
                throw new RefusedError(
                    'Grocery POS is not completely installed here; finish the install or repair first.',
                );
            const restoreJournal = await readJson(paths.restoreJournal).catch(
                () => undefined,
            );
            if (restoreJournal && !restoreJournal.completedAt)
                throw new RefusedError(
                    'An interrupted restore must be finished first.',
                );
            const fromInfo = await releaseInfo(state.release);
            // The installed release must match its own recorded manifest:
            // it is what a rollback re-registers (never a copy of whatever
            // happens to be on disk now).
            const record = await readReleaseRecord(paths, state.version);
            if (!record?.files)
                throw new RefusedError(
                    `The installed release ${state.version} has no recorded manifest; run a repair with its bundle first.`,
                );
            const damaged = await verifyTree(
                state.release,
                record.files,
                'release/',
            );
            if (damaged.length)
                throw new RefusedError(
                    `The installed release ${state.version} does not match its recorded manifest (${damaged.slice(0, 3).join('; ')}); repair it with its bundle before upgrading.`,
                );
            const from = describe(fromInfo, state.version);
            const apiDir = ctx.apiDir(state.release);
            const db = await withRoot(paths, apiDir, async (root) => {
                const database = await databaseFacts(root);
                return {
                    database,
                    ...(await lossChecks(root, {
                        createdAt: new Date().toISOString(),
                    })),
                    // Data a pending migration (#443) or a DATA_CHECKS rule (#483) would refuse.
                    migrationRefusals: await migrationRefusals(
                        root.db(APP_DATABASE),
                        migrations,
                        database.dataVersion,
                        to.data.dataVersion,
                    ),
                    // Archived product names (#483) only warn.
                    dataWarnings: await dataCheckWarnings(
                        root.db(APP_DATABASE),
                    ),
                };
            });
            for (const warning of db.dataWarnings) log(warning);
            const backup = statusSummary(await readStatus(paths));
            const refusals = evaluateUpgrade({
                from,
                to,
                database: db.database,
                openShifts: db.openShifts,
                activeLeases: db.activeLeases,
                leaseTerminals: db.leaseTerminals,
                backup,
                free: {
                    program: await ctx.freeBytes(loc.releasesDir),
                    data: await ctx.freeBytes(loc.dataRoot),
                },
                releaseBytes: bundle.releaseBytes,
            });
            refusals.push(...db.migrationRefusals);
            // AVX (#489): known absent refuses, unreadable only warns.
            if (ctx.readAvx) {
                const cpu = avxPreflight(await ctx.readAvx());
                refusals.push(...cpu.refusals);
                for (const warning of cpu.warnings) log(`warning: ${warning}`);
            }
            if (refusals.length) throw new RefusedError(refusals.join(' '));
            // LAN terminals (#396): a kept LAN IP that is absent right now is
            // a warning only; the switch's repair keeps it either way.
            if (state.lanIp && ctx.lanAddressFacts) {
                const lan = await ctx.lanAddressFacts(state.lanIp);
                if (!lan.lanIpPresent)
                    log(
                        `warning: the LAN IP ${state.lanIp} is not an address of this PC right now; LAN terminals cannot connect until it is back.`,
                    );
            }
            log(
                `preflight: ${from.version} (data ${from.data.dataVersion}) → ${to.version} (data ${to.data.dataVersion})`,
            );
            timings.preflight = Date.now() - t0 - timings.verify;
            journal = await writeJournal(paths, {
                schema: JOURNAL_SCHEMA,
                state: 'running',
                startedAt: new Date().toISOString(),
                from: {
                    version: from.version,
                    release: state.release,
                    appVersion: from.appVersion,
                    dataVersion: from.data.dataVersion,
                    dataInfo: fromInfo.data ?? null,
                    // Re-verified before a binary rollback re-registers it.
                    files: record.files,
                    manifestSha256: record.manifestSha256,
                },
                to: {
                    version: to.version,
                    appVersion: to.appVersion,
                    dataVersion: to.data.dataVersion,
                    manifestSha256: String(
                        options.manifestSha256,
                    ).toLowerCase(),
                },
                backupTime: state.backupTime,
                stages: {
                    verify: new Date().toISOString(),
                    preflight: new Date().toISOString(),
                },
                current: null,
                backupId: null,
                markerTouched: false,
                dataChanged: false,
                migrationsApplied: [],
                timings,
            });
        } else {
            log(
                `resume: upgrade to ${to.version} from stage ${journal.current ?? 'after ' + Object.keys(journal.stages).pop()}`,
            );
            journal = await writeJournal(paths, {
                ...journal,
                state: 'running',
                error: null,
            });
        }

        const stage = async (name, fn) => {
            if (journal.stages[name]) return;
            const started = Date.now();
            journal = await writeJournal(paths, { ...journal, current: name });
            await fault(name, 'before');
            const extra = (await fn()) ?? {};
            journal = await writeJournal(paths, {
                ...journal,
                ...extra,
                current: null,
                stages: { ...journal.stages, [name]: new Date().toISOString() },
                timings: { ...journal.timings, [name]: Date.now() - started },
            });
            await fault(name, 'after');
        };

        try {
            const fromApi = ctx.apiDir(journal.from.release);
            await stage('stop', async () => {
                log('stop: application and proxy (the database keeps running)');
                await holdServices(ctx);
                // Shifts cannot open with the API stopped: re-check now.
                const found = await withRoot(paths, fromApi, (root) =>
                    lossChecks(root, { createdAt: new Date().toISOString() }),
                );
                if (found.openShifts || found.activeLeases) {
                    const error = new RefusedError(
                        'A shift was opened or an offline lease taken while the upgrade started; nothing was changed.',
                    );
                    error.restart = true;
                    throw error;
                }
            });
            await stage('backup', async () => {
                log('backup: verified pre-upgrade backup');
                const bin = ctx.backupBinaries(journal.from.release);
                const result = await createBackup(
                    {
                        dataRoot: paths.root,
                        ...bin,
                        kind: 'pre-upgrade',
                        skipPrune: true,
                    },
                    (l) => log(`  ${l}`),
                );
                return { backupId: result.backupId };
            });
            await stage('place', async () => {
                await placeRelease(bundle, loc.releasesDir, (l) => log(l));
            });
            await stage('migrate', async () => {
                const release = join(loc.releasesDir, to.version);
                const plan = {
                    from: journal.from.dataVersion,
                    to: to.data.dataVersion,
                    release: to.version,
                    migrations: pendingMigrations(
                        migrations,
                        journal.from.dataVersion,
                        to.data.dataVersion,
                    ),
                };
                journal = await writeJournal(paths, {
                    ...journal,
                    markerTouched:
                        journal.markerTouched ||
                        plan.migrations.length > 0 ||
                        plan.from !== plan.to,
                });
                const applied = await withRoot(
                    paths,
                    ctx.apiDir(release),
                    (root) =>
                        runMigrations(root, plan, {
                            log,
                            onDataChange: async () => {
                                if (!journal.dataChanged)
                                    journal = await writeJournal(paths, {
                                        ...journal,
                                        dataChanged: true,
                                    });
                                await fault('migrate', 'data');
                            },
                        }),
                );
                return {
                    migrationsApplied: [
                        ...journal.migrationsApplied,
                        ...applied,
                    ],
                };
            });
            await stage('switch', async () => {
                log(`switch: services to ${to.version}`);
                await runInstaller(
                    {
                        mode: 'repair',
                        verifiedBundle: bundle,
                        backupTime: journal.backupTime,
                    },
                    ctx,
                    (l) => log(`  ${l}`),
                );
            });
            await stage('ready', async () => {
                const release = join(loc.releasesDir, to.version);
                let last = [];
                try {
                    await boundedWait(
                        async () => {
                            const r = await ctx.readiness(paths.root, release);
                            last = r.problems;
                            return r.ok;
                        },
                        {
                            timeoutMs: ctx.readyTimeoutMs ?? READY_TIMEOUT_MS,
                            intervalMs: 2000,
                        },
                    );
                } catch {
                    throw new Error(
                        `The new release did not become ready: ${last.join('; ') || 'no answer'}.`,
                    );
                }
            });
            journal = await writeJournal(paths, {
                ...journal,
                state: 'complete',
                completedAt: new Date().toISOString(),
                timings: {
                    ...journal.timings,
                    total: Date.now() - Date.parse(journal.startedAt),
                },
            });
            log(`upgrade: ${journal.from.version} → ${to.version} complete`);
            return summary(journal);
        } catch (error) {
            return await recover(paths, journal, ctx, error, log);
        }
    } finally {
        await releaseLock(lockPath(paths), token);
    }
}

function summary(journal) {
    return {
        state: journal.state,
        from: journal.from.version,
        to: journal.to.version,
        backupId: journal.backupId,
        migrationsApplied: journal.migrationsApplied,
        dataChanged: journal.dataChanged,
        timings: journal.timings,
        ...(journal.error ? { error: journal.error } : {}),
    };
}

/** After a failure past `preflight`: roll back what is safe, report the rest. */
async function recover(paths, journal, ctx, error, log) {
    const message = error instanceof Error ? error.message : String(error);
    if (error?.name === 'PowerCut') throw error; // tests: simulated kill
    if (isRefusal(error) && error.restart) {
        await releaseServices(ctx);
        for (const name of [SERVICES.api, SERVICES.proxy])
            await ctx.startService(name);
        await startLanProxy(ctx);
        await writeJournal(paths, {
            ...journal,
            state: 'refused',
            error: message,
        });
        throw error;
    }
    journal = await writeJournal(paths, {
        ...journal,
        state: 'failed',
        error: message,
    });
    log(`failed: ${message}`);
    const plan = recoveryPlan(journal);
    if (plan.action === 'binary-rollback') {
        try {
            await binaryRollback(paths, journal, ctx, log);
            journal = await writeJournal(paths, {
                ...journal,
                state: 'rolled-back',
                rolledBackAt: new Date().toISOString(),
            });
            const failed = new Error(
                `${message} The previous release ${journal.from.version} is running again; no data was changed.`,
            );
            failed.summary = summary(journal);
            throw failed;
        } catch (rollbackError) {
            if (rollbackError.summary) throw rollbackError;
            await writeJournal(paths, {
                ...journal,
                state: 'rollback-failed',
                rollbackError: rollbackError.message,
            });
            throw new Error(
                `${message} Rolling back also failed (${rollbackError.message}); run upgrade.mjs rollback.`,
            );
        }
    }
    await writeJournal(paths, { ...journal, state: 'needs-recovery' });
    throw new Error(
        `${message} A migration may have changed data, so the previous release cannot run on it. Either re-run the same upgrade to finish it, or run upgrade.mjs rollback --restore-backup ${journal.backupId} to restore the pre-upgrade backup and the previous release.`,
    );
}

/**
 * Explicit rollback of an unfinished (or failed) upgrade. Without data
 * changes: binary rollback. With: only `--restore-backup <the journal's
 * pre-upgrade backup id>`, through restore.mjs (which refuses losing sales
 * recorded after that backup unless `--accept-newer-sales`).
 */
export async function runRollback(options, ctx, log = () => {}) {
    const paths = layout(ctx.locations.dataRoot);
    let token;
    try {
        token = await acquireLock(lockPath(paths));
    } catch {
        throw new RefusedError('Another upgrade run is active.');
    }
    try {
        let journal = await readJournal(paths);
        if (
            !journal ||
            ['complete', 'rolled-back', 'refused'].includes(journal.state)
        )
            throw new RefusedError(
                'There is no unfinished upgrade to roll back.',
            );
        const plan = recoveryPlan(journal);
        if (plan.action === 'restore-required' || options.restoreBackup) {
            if (!options.restoreBackup)
                throw new RefusedError(
                    `A migration may have changed data. Rolling back restores the pre-upgrade backup ${journal.backupId}: re-run with --restore-backup ${journal.backupId}. Or re-run the upgrade to finish it.`,
                );
            if (!journal.backupId || options.restoreBackup !== journal.backupId)
                throw new RefusedError(
                    `--restore-backup must name this upgrade's pre-upgrade backup ${journal.backupId ?? '(none was taken)'}.`,
                );
            await holdServices(ctx);
            const bin = ctx.backupBinaries(journal.from.release);
            log(`rollback: restoring pre-upgrade backup ${journal.backupId}`);
            await restore(
                {
                    dataRoot: paths.root,
                    from: join(paths.dirs.backups, journal.backupId),
                    confirm: options.restoreBackup,
                    ...bin,
                    acceptNewerSales: options.acceptNewerSales === true,
                    // Back to the previous release's data version, never forward.
                    dataVersion: journal.from.dataVersion,
                    minDataVersion: journal.from.dataVersion,
                    migrations: [],
                },
                (l) => log(`  ${l}`),
            );
            journal = await writeJournal(paths, {
                ...journal,
                dataChanged: false,
                markerTouched: false,
                restoredBackupId: journal.backupId,
            });
        }
        try {
            await binaryRollback(paths, journal, ctx, log);
        } catch (error) {
            await writeJournal(paths, {
                ...journal,
                state: 'rollback-failed',
                rollbackError: error.message,
            });
            throw error;
        }
        journal = await writeJournal(paths, {
            ...journal,
            state: 'rolled-back',
            rolledBackAt: new Date().toISOString(),
        });
        return summary(journal);
    } finally {
        await releaseLock(lockPath(paths), token);
    }
}

export async function upgradeStatus(ctx) {
    const paths = layout(ctx.locations.dataRoot);
    const journal = await readJournal(paths);
    if (!journal) return { state: 'none' };
    const { files: _files, ...from } = journal.from;
    return { ...journal, from, recovery: recoveryPlan(journal) };
}

// ------------------------------------------------------------ Windows context

function execCapture(file, args) {
    return new Promise((done) => {
        execFile(file, args, { windowsHide: true }, (error) =>
            done({
                code: error
                    ? typeof error.code === 'number'
                        ? error.code
                        : 1
                    : 0,
            }),
        );
    });
}

export async function freeBytes(path) {
    let current = path;
    for (;;) {
        const info = await statfs(current).catch(() => undefined);
        if (info) return Number(info.bavail) * Number(info.bsize);
        const parent = dirname(current);
        if (parent === current) return undefined;
        current = parent;
    }
}

/** Readiness through the #365 diagnostics report. */
export async function diagnosticsReadiness(
    dataRoot,
    release,
    checks = READINESS_CHECKS,
) {
    const report = await diagnose({ dataRoot, release });
    const problems = report.checks
        .filter((c) => checks.includes(c.id))
        .filter(
            (c) =>
                !['ok', 'info'].includes(c.status) &&
                !(c.id === 'services' && c.status === 'unknown'),
        )
        .map((c) => `${c.id}: ${c.summary}`);
    return { ok: problems.length === 0, problems };
}

/** The installer's Windows context plus what the upgrade needs. */
export function upgradeContext(env = process.env) {
    const base = windowsContext(env);
    return {
        ...base,
        async setStartMode(name, mode) {
            const { code } = await execCapture('sc.exe', [
                'config',
                name,
                'start=',
                mode,
            ]);
            if (code !== 0 && code !== 1060)
                throw new Error(
                    `Could not set ${name} to ${mode} (exit ${code}).`,
                );
        },
        freeBytes,
        lanAddressFacts,
        readAvx,
        readiness: (dataRoot, release) =>
            diagnosticsReadiness(dataRoot, release),
        apiDir: (release) => releaseLayout(release).api,
        backupBinaries: (release) => ({
            mongod: releaseLayout(release).mongod,
            tools: join(release, 'mongodb', 'bin'),
            api: releaseLayout(release).api,
        }),
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
            'Refused: the upgrade runs on Windows 10 or Windows 11 only.\n',
        );
        return EXIT.REFUSED;
    }
    const ctx = upgradeContext();
    const out = (line) => process.stdout.write(`${line}\n`);
    try {
        const result =
            options.command === 'upgrade'
                ? await runUpgrade(options, ctx, out)
                : options.command === 'rollback'
                  ? await runRollback(options, ctx, out)
                  : await upgradeStatus(ctx);
        out(JSON.stringify(result, null, 2));
        return EXIT.OK;
    } catch (error) {
        if (isRefusal(error)) {
            process.stderr.write(`Refused: ${error.message}\n`);
            return EXIT.REFUSED;
        }
        process.stderr.write(
            `Failed: ${error instanceof Error && !/mongodb(\+srv)?:\/\//.test(error.message) ? error.message : 'unexpected error'}\n`,
        );
        return EXIT.FAILED;
    }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    process.exit(await main());
}
