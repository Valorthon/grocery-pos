// Single-PC restore (#363): the separate, protected maintenance tool.
// Replaces this installation's data with a verified backup, or rebuilds a
// replacement PC's installation from one. Run as an administrator with the
// API and proxy services stopped. See README.md "Restore".
//
//   node restore.mjs --data-root <abs> --from <backup dir> --confirm <backup id>
//       --mongod <mongod> --tools <dir> --api <api dir>
//       [--accept-open-shifts] [--accept-newer-sales] [--accept-pending-offline]
//
// Exit codes: 0 restored, 1 failure, 2 usage, 3 refused (nothing changed).
import { spawn } from 'node:child_process';
import { connect as netConnect } from 'node:net';
import {
    chmod,
    copyFile,
    mkdir,
    readdir,
    readFile,
    rm,
    stat,
    writeFile,
} from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { boundedWait } from '../proof/policy.mjs';
import {
    APP_DATABASE,
    LOOPBACK,
    PORTS,
    SECRET_FILES,
    layout,
} from '../runtime/layout.mjs';
import { provision } from '../runtime/provision.mjs';
import { assertAdminOnly, assertOnly, secureFolder } from './acl.mjs';
import {
    DATA_VERSION,
    MIGRATIONS,
    MIN_UPGRADE_FROM,
    pendingMigrations,
    runMigrations,
} from '../upgrade/migrations.mjs';
import {
    ARCHIVE,
    BACKED_UP_SECRETS,
    BackupError,
    CA_ROOT_FILES,
    EXIT,
    RefusedError,
    appVersion,
    checkBackup,
    checkInstallationDatabase,
    compatibility,
    connectRoot,
    createBackup,
    mongoDriver,
    mongodVersion,
    parseOptions,
    readInstall,
    readRootPassword,
    readStatus,
    report,
    rootUri,
    runTool,
    toolPath,
    withLock,
    writeAtomic,
} from './backup.mjs';

/** Collections cleared after a restore: every session must log in again,
 *  and no pending step-up or manager approval survives (#310, #34). */
export const SESSION_COLLECTIONS = Object.freeze([
    'refreshtokens',
    'stepups',
    'overridegrants',
]);

const ALLOWED = [
    'data-root',
    'from',
    'confirm',
    'mongod',
    'tools',
    'api',
    'accept-open-shifts',
    'accept-newer-sales',
    'accept-pending-offline',
];

export function parseArgs(args) {
    return parseOptions(
        args,
        ['dataRoot', 'from', 'confirm', 'mongod', 'tools', 'api'],
        ALLOWED,
    );
}

const windows = process.platform === 'win32';

function portInUse(port) {
    return new Promise((done) => {
        const socket = netConnect({ host: LOOPBACK, port });
        socket.setTimeout(1000);
        socket.once('connect', () => {
            socket.destroy();
            done(true);
        });
        socket.once('timeout', () => {
            socket.destroy();
            done(true);
        });
        socket.once('error', () => done(false));
    });
}

async function isEmptyOrAbsent(root) {
    try {
        return (await readdir(root)).length === 0;
    } catch (error) {
        if (error.code === 'ENOENT') return true;
        throw error;
    }
}

/**
 * What a restore would lose on the current database. Each is refused
 * unless the operator accepts it with its own flag (README "Restore").
 */
export async function lossChecks(root, manifest) {
    const db = root.db(APP_DATABASE);
    const openShifts = await db
        .collection('shifts')
        .countDocuments({ status: 'OPEN' });
    const leaseTerminals = await blockingLeases(db);
    const newerSales = await db.collection('sales').countDocuments({
        createdAt: { $gt: new Date(manifest.createdAt) },
    });
    return {
        openShifts,
        activeLeases: leaseTerminalCount(leaseTerminals),
        leaseTerminals,
        newerSales,
    };
}

/**
 * The terminals whose offline cash leases still block (#453): active,
 * not expired, and on a shift that is still OPEN. An expired lease or one
 * on a closed (e.g. force-closed) shift can take no new offline sale; its
 * queued cash still needs ADMIN reconciliation (#37). One entry per
 * terminal and shift, with the shift's terminal label and cashier; a
 * lease whose shift is missing or that has no `expiresAt` never blocks.
 */
export async function blockingLeases(db, now = new Date()) {
    const rows = await db
        .collection('offlineleases')
        .aggregate([
            { $match: { active: true, expiresAt: { $gt: now } } },
            {
                $lookup: {
                    from: 'shifts',
                    localField: 'shift',
                    foreignField: '_id',
                    as: 'shiftDoc',
                },
            },
            { $unwind: '$shiftDoc' },
            { $match: { 'shiftDoc.status': 'OPEN' } },
            {
                $group: {
                    _id: { terminalId: '$terminalId', shift: '$shift' },
                    label: { $first: '$shiftDoc.terminal' },
                    cashier: { $first: '$shiftDoc.cashierName' },
                },
            },
            { $sort: { '_id.terminalId': 1, '_id.shift': 1 } },
        ])
        .toArray();
    return rows.map((row) => ({
        terminalId: String(row._id.terminalId ?? ''),
        label: typeof row.label === 'string' ? row.label : '',
        cashier: typeof row.cashier === 'string' ? row.cashier : '',
    }));
}

/** Distinct terminals: one PC with two cashiers' shifts is one terminal. */
export function leaseTerminalCount(terminals = []) {
    return new Set(terminals.map((t) => t.terminalId)).size;
}

/** "Till 1 (terminal 3f2a…, cashier ana), terminal 9c…" for a refusal. */
export function describeLeaseTerminals(terminals = []) {
    return terminals
        .map(({ terminalId, label, cashier }) => {
            const parts = [`terminal ${terminalId || 'unknown'}`];
            if (cashier) parts.push(`cashier ${cashier}`);
            return label ? `${label} (${parts.join(', ')})` : parts.join(', ');
        })
        .join(', ');
}

/**
 * The one lease refusal wording (#453), shared by restore, upgrade and the
 * installer: "N terminal(s) still hold offline cash leases: Till 7 (…)".
 */
export function leaseRefusal(count, terminals = []) {
    const named = describeLeaseTerminals(terminals);
    return `${count} terminal(s) still hold offline cash leases${named ? `: ${named}` : ''}`;
}

export function lossRefusals(found, options) {
    const out = [];
    if (found.openShifts && !options.acceptOpenShifts)
        out.push(
            `${found.openShifts} shift(s) are open; close them first or pass --accept-open-shifts`,
        );
    if (found.activeLeases && !options.acceptPendingOffline)
        out.push(
            `${leaseRefusal(found.activeLeases, found.leaseTerminals)}; they may have unsynchronized receipts: synchronize them first or pass --accept-pending-offline`,
        );
    if (found.newerSales && !options.acceptNewerSales)
        out.push(
            `${found.newerSales} sale(s) were recorded after this backup and would be lost; pass --accept-newer-sales`,
        );
    return out;
}

async function startMongod(mongod, paths) {
    const child = spawn(mongod, ['--config', paths.mongodConfig], {
        stdio: 'ignore',
        windowsHide: true,
    });
    let exited = false;
    child.once('exit', () => (exited = true));
    child.once('error', () => (exited = true));
    await boundedWait(
        async () => {
            if (exited)
                throw new BackupError(
                    'DATABASE_UNAVAILABLE',
                    'mongod did not start.',
                );
            return portInUse(PORTS.mongo);
        },
        { timeoutMs: 120000 },
    );
    return child;
}

async function stopMongod(child, root) {
    if (!child || child.exitCode !== null) return;
    const exited = new Promise((done) => child.once('exit', done));
    try {
        await root?.db('admin').command({ shutdown: 1 });
    } catch {
        // expected: the connection drops
    }
    if (!root) child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
    await exited;
    clearTimeout(timer);
}

export { ADMIN_SIDS, aclProblems, secureFolderSteps } from './acl.mjs';

/**
 * Creates (or takes) the fresh data root and its secrets folder and makes
 * both admin-only before secrets are copied (#366): the parent must be
 * admin-owned (or is created and secured here), an existing root must be an
 * admin-owned plain folder, neither may be a junction or link, and the root
 * must hold only the secrets folder this run created. Any non-admin entry
 * left after restricting refuses the restore.
 */
export async function secureFreshRoot(paths, ctx = {}) {
    await secureFolder(paths.root, ctx);
    await assertOnly(paths.root, ['secrets']);
    await secureFolder(paths.dirs.secrets, ctx);
    for (const path of [paths.root, paths.dirs.secrets])
        await assertAdminOnly(path, ctx);
    await assertOnly(paths.root, ['secrets']);
    await assertOnly(paths.dirs.secrets, []);
}

const exists = (path) =>
    stat(path).then(
        () => true,
        () => false,
    );

/**
 * Places the backup's secrets, identity, runtime manifest (its LAN IP, #396)
 * and local CA root (#396) on a fresh data root. Returns whether the root
 * was restored.
 */
async function seedFreshRoot(paths, dir) {
    await secureFreshRoot(paths);
    for (const sub of ['state', 'config']) {
        await mkdir(paths.dirs[sub], { recursive: true, mode: 0o700 });
    }
    const files = [
        ...BACKED_UP_SECRETS.map((key) => [
            `files/secrets/${SECRET_FILES[key].file}`,
            paths.secrets[key],
        ]),
        ['files/state/install.json', paths.install],
        // Keeps the LAN IP setting (#396); provisioning rewrites the rest.
        ['files/config/runtime.json', paths.runtimeManifest],
    ];
    // The local CA root (#396), when the backup has it: Caddy keeps using
    // it, so LAN terminals that trusted the old PC trust this one. Older
    // backups have none; Caddy then makes a new root and terminals re-join.
    const caRoot = [];
    for (const rel of CA_ROOT_FILES)
        if (await exists(join(dir, 'files', ...rel.split('/'))))
            caRoot.push(rel);
    if (caRoot.length === CA_ROOT_FILES.length) {
        await secureFolder(paths.dirs.tls);
        for (const rel of caRoot) {
            const target = join(paths.root, ...rel.split('/'));
            await mkdir(dirname(target), { recursive: true, mode: 0o700 });
            files.push([`files/${rel}`, target]);
        }
    }
    for (const [rel, target] of files) {
        await copyFile(join(dir, ...rel.split('/')), target);
        if (!windows) await chmod(target, 0o600);
    }
    return caRoot.length === CA_ROOT_FILES.length;
}

async function sameFile(a, b) {
    try {
        return (await readFile(a)).equals(await readFile(b));
    } catch {
        return false;
    }
}

/**
 * The audit entry, built with the release's own compiled allowlist
 * (`auditFields`), so it holds exactly the SYSTEM.DATABASE_RESTORED fields.
 */
export function auditWriter(apiDir) {
    const api = resolve(apiDir);
    const load = createRequire(join(api, 'package.json'));
    let fields;
    let action;
    try {
        fields = load(join(api, 'dist', 'audit', 'audit-fields.js'));
        action = load('@grocery-pos/contracts').AuditAction
            .SYSTEM_DATABASE_RESTORED;
    } catch {
        action = undefined;
    }
    if (!action || typeof fields?.auditFields !== 'function')
        throw new BackupError(
            'TOOLS_UNAVAILABLE',
            "The release's compiled API is required to record the restore in the audit log.",
        );
    return (after) => ({
        actor: null,
        actorName: null,
        action,
        targetModel: 'Database',
        targetId: null,
        before: {},
        after: fields.auditFields(action, after),
        approvedBy: null,
        ip: null,
        userAgent: null,
        createdAt: new Date(),
    });
}

/**
 * A new cookie secret ends every pre-restore session at once: the API only
 * accepts access tokens from cookies this secret signs. The JWT secret
 * (offline evidence, #37) is kept. Rewrites api.env's line in place.
 */
export async function rotateCookieSecret(paths) {
    const spec = SECRET_FILES.cookieSecret;
    const value = randomBytes(spec.bytes).toString(spec.encoding);
    const env = await readFile(paths.apiEnv, 'utf8');
    if (!/^COOKIE_SECRET=.*$/m.test(env))
        throw new BackupError(
            'RESTORE_FAILED',
            'api.env has no COOKIE_SECRET line; re-run provisioning.',
        );
    await writeAtomic(paths.secrets.cookieSecret, value);
    await writeAtomic(
        paths.apiEnv,
        env.replace(/^COOKIE_SECRET=.*$/m, `COOKIE_SECRET=${value}`),
    );
}

export async function restore(options, log = () => {}) {
    const dir = resolve(options.from);
    const paths = layout(resolve(options.dataRoot));
    // 1. The backup must be intact, verified and compatible: read-only checks.
    const { manifest, verification } = await checkBackup(dir);
    if (options.confirm !== manifest.backupId)
        throw new RefusedError(
            `Restore replaces all store data with backup ${manifest.backupId} (taken ${manifest.createdAt}). Re-run with --confirm ${manifest.backupId} to proceed.`,
        );
    // The data version this release runs (#364): its own registry, or the
    // previous release's when an upgrade rollback restores its backup.
    const migrations = options.migrations ?? MIGRATIONS;
    const target = {
        mongodb: await mongodVersion(options.mongod),
        app: await appVersion(options.api),
        dataVersion: options.dataVersion ?? DATA_VERSION,
        minDataVersion: options.minDataVersion ?? MIN_UPGRADE_FROM,
    };
    const problems = compatibility(manifest, target);
    if (problems.length)
        throw new RefusedError(`Incompatible backup: ${problems.join('; ')}.`);
    const auditEntry = auditWriter(options.api);
    if (await portInUse(PORTS.api))
        throw new RefusedError(
            `The API is running (port ${PORTS.api}). Stop GroceryPOS-ProxyLan (if installed), GroceryPOS-Proxy and GroceryPOS-API before restoring.`,
        );

    const fresh = await isEmptyOrAbsent(paths.root);
    if (fresh) {
        log(
            `restore ${manifest.backupId}: new installation from the backup's identity and secrets`,
        );
        const caRoot = await seedFreshRoot(paths, dir);
        const { lanIp } = await provision(
            { dataRoot: paths.root, mongod: options.mongod, api: options.api },
            (l) => log(`provision ${l}`),
        );
        log(
            caRoot
                ? 'restore: local CA root restored; joined LAN terminals keep trusting this PC'
                : 'restore: this backup has no local CA root; the installer makes a new one and every LAN terminal re-joins',
        );
        if (lanIp)
            log(
                `restore: LAN terminals use https://${lanIp}:${PORTS.proxy}; give this PC that fixed IP before running the installer, or install and then run repair with -LanIp <new IP> (terminals then re-join) or -LanIp none`,
            );
    } else {
        const install = await readInstall(paths);
        if (install.installationId !== manifest.installationId)
            throw new RefusedError(
                'The backup belongs to another installation. Restore it onto an empty data root (replacement PC) instead.',
            );
        for (const key of BACKED_UP_SECRETS) {
            const { file } = SECRET_FILES[key];
            if (
                !(await sameFile(
                    paths.secrets[key],
                    join(dir, 'files', 'secrets', file),
                ))
            )
                throw new RefusedError(
                    `Secret ${file} differs from the backup's; this restore cannot proceed safely.`,
                );
        }
        // A replacement installation whose provisioning was interrupted resumes it.
        const provisioned = JSON.parse(
            await readFile(paths.journal, 'utf8').catch(() => '{}'),
        );
        if (!provisioned.complete)
            await provision(
                {
                    dataRoot: paths.root,
                    mongod: options.mongod,
                    api: options.api,
                },
                (l) => log(`provision ${l}`),
            );
    }

    return withLock(paths, async () => {
        const install = await readInstall(paths);
        const journalText = await readFile(paths.restoreJournal, 'utf8').catch(
            () => undefined,
        );
        const journal = journalText ? JSON.parse(journalText) : undefined;
        const resuming = journal && !journal.completedAt;
        if (resuming && journal.backupId !== manifest.backupId)
            throw new RefusedError(
                `An interrupted restore of ${journal.backupId} must be finished first (its safety backup is ${journal.safetyBackupId ?? 'none'}).`,
            );
        const driver = mongoDriver(options.api);
        const password = await readRootPassword(paths);
        const child = (await portInUse(PORTS.mongo))
            ? undefined
            : await startMongod(options.mongod, paths);
        let root;
        try {
            root = await connectRoot(driver, password);
            await boundedWait(
                async () =>
                    (await root.db('admin').command({ hello: 1 }))
                        .isWritablePrimary === true,
                {
                    timeoutMs: 120000,
                },
            );
            await checkInstallationDatabase(root, install);

            let safetyBackupId = journal?.safetyBackupId;
            if (!resuming && !fresh) {
                const refusals = lossRefusals(
                    await lossChecks(root, manifest),
                    options,
                );
                if (refusals.length)
                    throw new RefusedError(
                        `Restore would lose data: ${refusals.join('; ')}.`,
                    );
                log(
                    'restore: taking a safety backup of the current data first',
                );
                const safety = await createBackup(
                    {
                        ...options,
                        kind: 'pre-restore',
                        lockHeld: true,
                        skipPrune: true,
                    },
                    (l) => log(`safety ${l}`),
                );
                safetyBackupId = safety.backupId;
            }
            const started = new Date().toISOString();
            await writeAtomic(
                paths.restoreJournal,
                JSON.stringify(
                    {
                        backupId: manifest.backupId,
                        from: dir,
                        safetyBackupId: safetyBackupId ?? null,
                        startedAt: started,
                        completedAt: null,
                    },
                    null,
                    2,
                ) + '\n',
            );
            log(`restore ${manifest.backupId}: replacing the store database`);
            await root.db(APP_DATABASE).dropDatabase();
            const configPath = join(
                paths.dirs.backups,
                `.restore-${process.pid}.yaml`,
            );
            await writeFile(
                configPath,
                `uri: ${JSON.stringify(rootUri(password))}\n`,
                { flag: 'wx', mode: 0o600 },
            );
            const mongorestore = (args) =>
                runTool(
                    toolPath(options.tools, 'mongorestore'),
                    [
                        `--config=${configPath}`,
                        `--archive=${join(dir, ARCHIVE)}`,
                        '--gzip',
                        '--stopOnError',
                        ...args,
                    ],
                    { secrets: [password] },
                );
            let result;
            try {
                // Users first, on their own: a replacement installation's
                // provisioned users are new identities, and replacing them
                // ends every authenticated connection, which would break the
                // oplog replay below. The backup's users carry the same
                // passwords (the backed-up secrets).
                result = await mongorestore([
                    '--drop',
                    '--nsInclude=admin.system.users',
                    '--nsInclude=admin.system.roles',
                    '--nsInclude=admin.system.version',
                ]);
                if (result.code === 0)
                    result = await mongorestore(['--oplogReplay', '--drop']);
            } finally {
                await rm(configPath, { force: true });
            }
            if (result.code !== 0)
                throw new BackupError(
                    'RESTORE_FAILED',
                    `mongorestore failed. Re-run the same restore to retry${safetyBackupId ? `; the previous data is in safety backup ${safetyBackupId}` : ''}.`,
                    result.output,
                );
            // Our own connection may have been ended by the user replacement.
            await root.close().catch(() => {});
            root = await connectRoot(driver, password);
            // The restored data must be exactly what the test restore saw.
            const db = root.db(APP_DATABASE);
            for (const [name, count] of Object.entries(
                verification.collections,
            )) {
                const actual = await db.collection(name).countDocuments({});
                if (actual !== count)
                    throw new BackupError(
                        'RESTORE_FAILED',
                        `Restored ${name} has ${actual} documents, the backup ${count}.`,
                    );
            }
            await checkInstallationDatabase(root, install);
            // An older-data backup is taken forward to this release's data
            // version (#364), so its API can start on it.
            const backupData = manifest.versions?.data ?? 1;
            let migrated = [];
            if (backupData < target.dataVersion) {
                log(
                    `restore: migrating data ${backupData} → ${target.dataVersion}`,
                );
                migrated = await runMigrations(
                    root,
                    {
                        from: backupData,
                        to: target.dataVersion,
                        release: 'restore',
                        migrations: pendingMigrations(
                            migrations,
                            backupData,
                            target.dataVersion,
                        ),
                    },
                    { log },
                );
            }
            // Recorded in the restored database, so it survives the restore.
            await db.collection('auditlogs').insertOne(
                auditEntry({
                    backupId: manifest.backupId,
                    backupCreatedAt: manifest.createdAt,
                    safetyBackupId: safetyBackupId ?? null,
                    replacementInstallation: fresh,
                    acceptOpenShifts: options.acceptOpenShifts === true,
                    acceptNewerSales: options.acceptNewerSales === true,
                    acceptPendingOffline: options.acceptPendingOffline === true,
                    source: 'restore.mjs',
                }),
            );
            for (const name of SESSION_COLLECTIONS)
                await db.collection(name).deleteMany({});
            await rotateCookieSecret(paths);
            const completedAt = new Date().toISOString();
            const summary = {
                backupId: manifest.backupId,
                backupCreatedAt: manifest.createdAt,
                safetyBackupId: safetyBackupId ?? null,
                replacementInstallation: fresh,
                startedAt: started,
                completedAt,
                collections: verification.collections,
                dataVersion: target.dataVersion,
                migrated,
            };
            await writeAtomic(
                paths.restoreJournal,
                JSON.stringify({ ...summary, from: dir }, null, 2) + '\n',
            );
            const status = await readStatus(paths).catch(() => undefined);
            if (status) {
                await writeAtomic(
                    paths.backupStatus,
                    JSON.stringify(
                        {
                            ...status,
                            lastRestore: {
                                at: completedAt,
                                backupId: manifest.backupId,
                                safetyBackupId: safetyBackupId ?? null,
                            },
                            updatedAt: completedAt,
                        },
                        null,
                        2,
                    ) + '\n',
                );
            }
            log(
                `restore ${manifest.backupId}: done; every user must log in again`,
            );
            return summary;
        } finally {
            await stopMongod(child, root);
            await root?.close().catch(() => {});
        }
    });
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
        const result = await restore(options, (line) =>
            process.stdout.write(`${line}\n`),
        );
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return EXIT.OK;
    } catch (error) {
        return report(error);
    }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    process.exit(await main());
}
