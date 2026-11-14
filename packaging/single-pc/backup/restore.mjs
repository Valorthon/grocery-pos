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
    writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
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
import {
    ARCHIVE,
    BackupError,
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
    const activeLeases = await db
        .collection('offlineleases')
        .countDocuments({ active: true });
    const newerSales = await db.collection('sales').countDocuments({
        createdAt: { $gt: new Date(manifest.createdAt) },
    });
    return { openShifts, activeLeases, newerSales };
}

export function lossRefusals(found, options) {
    const out = [];
    if (found.openShifts && !options.acceptOpenShifts)
        out.push(
            `${found.openShifts} shift(s) are open; close them first or pass --accept-open-shifts`,
        );
    if (found.activeLeases && !options.acceptPendingOffline)
        out.push(
            `${found.activeLeases} terminal(s) hold offline cash leases that may have unsynchronized receipts; synchronize them first or pass --accept-pending-offline`,
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

/** Places the backup's secrets and identity on a fresh data root. */
async function seedFreshRoot(paths, dir) {
    await mkdir(paths.root, { recursive: true, mode: 0o700 });
    for (const sub of ['secrets', 'state', 'config']) {
        await mkdir(paths.dirs[sub], { recursive: true, mode: 0o700 });
    }
    const files = [
        ...Object.keys(SECRET_FILES).map((key) => [
            `files/secrets/${SECRET_FILES[key].file}`,
            paths.secrets[key],
        ]),
        ['files/state/install.json', paths.install],
    ];
    for (const [rel, target] of files) {
        await copyFile(join(dir, ...rel.split('/')), target);
        if (!windows) await chmod(target, 0o600);
    }
}

async function sameFile(a, b) {
    try {
        return (await readFile(a)).equals(await readFile(b));
    } catch {
        return false;
    }
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
    const target = {
        mongodb: await mongodVersion(options.mongod),
        app: await appVersion(options.api),
    };
    const problems = compatibility(manifest, target);
    if (problems.length)
        throw new RefusedError(`Incompatible backup: ${problems.join('; ')}.`);
    if (await portInUse(PORTS.api))
        throw new RefusedError(
            `The API is running (port ${PORTS.api}). Stop GroceryPOS-Proxy and GroceryPOS-API before restoring.`,
        );

    const fresh = await isEmptyOrAbsent(paths.root);
    if (fresh) {
        log(
            `restore ${manifest.backupId}: new installation from the backup's identity and secrets`,
        );
        await seedFreshRoot(paths, dir);
        await provision(
            { dataRoot: paths.root, mongod: options.mongod, api: options.api },
            (l) => log(`provision ${l}`),
        );
    } else {
        const install = await readInstall(paths);
        if (install.installationId !== manifest.installationId)
            throw new RefusedError(
                'The backup belongs to another installation. Restore it onto an empty data root (replacement PC) instead.',
            );
        for (const [key, { file }] of Object.entries(SECRET_FILES)) {
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
                    { ...options, kind: 'pre-restore', lockHeld: true },
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
            for (const name of SESSION_COLLECTIONS)
                await db.collection(name).deleteMany({});
            const completedAt = new Date().toISOString();
            const summary = {
                backupId: manifest.backupId,
                backupCreatedAt: manifest.createdAt,
                safetyBackupId: safetyBackupId ?? null,
                replacementInstallation: fresh,
                startedAt: started,
                completedAt,
                collections: verification.collections,
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
