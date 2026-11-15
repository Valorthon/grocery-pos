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
import { execFileSync, spawn } from 'node:child_process';
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

async function exists(path) {
    return Boolean(await stat(path).catch(() => undefined));
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

/** Well-known SIDs: SYSTEM and BUILTIN\Administrators. */
export const ADMIN_SIDS = Object.freeze(['S-1-5-18', 'S-1-5-32-544']);

/**
 * Windows commands that make a folder admin-only before any secret is
 * copied into it (#366): owner Administrators, inheritance removed, only
 * SYSTEM and Administrators granted.
 */
export function secureFolderSteps(path) {
    return [
        ['icacls', [path, '/setowner', '*S-1-5-32-544']],
        [
            'icacls',
            [
                path,
                '/inheritance:r',
                '/grant:r',
                '*S-1-5-18:(OI)(CI)F',
                '*S-1-5-32-544:(OI)(CI)F',
            ],
        ],
    ];
}

/** PowerShell that prints a folder's owner SID and every ACE's SID. */
export function aclQuery(path) {
    const literal = path.replace(/'/g, "''");
    return [
        'powershell.exe',
        [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `$a = Get-Acl -LiteralPath '${literal}'; $s = [System.Security.Principal.SecurityIdentifier]; ` +
                `[pscustomobject]@{ Owner = $a.GetOwner($s).Value; Sids = @($a.GetAccessRules($true, $true, $s) | ForEach-Object { $_.IdentityReference.Value }) } | ConvertTo-Json -Compress`,
        ],
    ];
}

/** Problems with a folder's ACL facts (`{Owner, Sids}`), else []. */
export function aclProblems(facts, { checkAces = true } = {}) {
    const problems = [];
    if (!ADMIN_SIDS.includes(facts?.Owner))
        problems.push(`owned by ${facts?.Owner ?? 'unknown'}`);
    if (checkAces)
        for (const sid of [].concat(facts?.Sids ?? []))
            if (!ADMIN_SIDS.includes(sid)) problems.push(`grants ${sid}`);
    return problems;
}

const realExec = (file, args) =>
    execFileSync(file, args, {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30000,
    });

/**
 * Creates (or takes) the fresh data root and its secrets folder and makes
 * both admin-only before secrets are copied. A root that already exists
 * must be owned by SYSTEM or Administrators, else nothing is changed; after
 * restricting, any remaining non-admin entry refuses the restore.
 */
export async function secureFreshRoot(
    paths,
    { platform = process.platform, exec = realExec, rootExisted } = {},
) {
    const facts = (path) => JSON.parse(exec(...aclQuery(path)));
    if (platform === 'win32' && rootExisted) {
        const problems = aclProblems(facts(paths.root), { checkAces: false });
        if (problems.length)
            throw new RefusedError(
                `The empty data root ${paths.root} already exists and is ${problems.join(', ')}. Delete it and restore again.`,
            );
    }
    await mkdir(paths.root, { recursive: true, mode: 0o700 });
    if (platform === 'win32') {
        for (const step of secureFolderSteps(paths.root)) exec(...step);
    }
    await mkdir(paths.dirs.secrets, { recursive: true, mode: 0o700 });
    if (platform === 'win32') {
        for (const step of secureFolderSteps(paths.dirs.secrets)) exec(...step);
        for (const path of [paths.root, paths.dirs.secrets]) {
            const problems = aclProblems(facts(path));
            if (problems.length)
                throw new RefusedError(
                    `${path} is not admin-only (${problems.join(', ')}); no secret was copied.`,
                );
        }
    } else {
        await chmod(paths.root, 0o700);
        await chmod(paths.dirs.secrets, 0o700);
    }
}

/** Places the backup's secrets and identity on a fresh data root. */
async function seedFreshRoot(paths, dir, rootExisted) {
    await secureFreshRoot(paths, { rootExisted });
    for (const sub of ['state', 'config']) {
        await mkdir(paths.dirs[sub], { recursive: true, mode: 0o700 });
    }
    const files = [
        ...BACKED_UP_SECRETS.map((key) => [
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
            `The API is running (port ${PORTS.api}). Stop GroceryPOS-Proxy and GroceryPOS-API before restoring.`,
        );

    const fresh = await isEmptyOrAbsent(paths.root);
    const rootExisted = fresh && (await exists(paths.root));
    if (fresh) {
        log(
            `restore ${manifest.backupId}: new installation from the backup's identity and secrets`,
        );
        await seedFreshRoot(paths, dir, rootExisted);
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
