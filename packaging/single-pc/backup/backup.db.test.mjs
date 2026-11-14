// Real-MongoDB backup/restore checks (#363). Needs MongoDB 7 `mongod`
// (GPOS_TEST_MONGOD) and a directory holding `mongodump`/`mongorestore`
// (GPOS_TEST_MONGO_TOOLS), and free loopback ports 27018/13000; skipped
// otherwise. With a built API (apps/api/dist) it also logs in to the
// restored replacement installation.
//   GPOS_TEST_MONGOD=… GPOS_TEST_MONGO_TOOLS=… node --test packaging/single-pc/backup/backup.db.test.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import {
    cp,
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    stat,
    writeFile,
} from 'node:fs/promises';
import { request } from 'node:http';
import { connect } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { boundedWait } from '../proof/policy.mjs';
import { DB_USERS, ORIGIN, PORTS, layout } from '../runtime/layout.mjs';

const MONGOD = process.env.GPOS_TEST_MONGOD;
const TOOLS = process.env.GPOS_TEST_MONGO_TOOLS;
const repo = fileURLToPath(new URL('../../..', import.meta.url));
const apiDir = join(repo, 'apps', 'api');
const provisionCli = fileURLToPath(
    new URL('../runtime/provision.mjs', import.meta.url),
);
const backupCli = fileURLToPath(new URL('./backup.mjs', import.meta.url));
const restoreCli = fileURLToPath(new URL('./restore.mjs', import.meta.url));
const compiledApi = existsSync(join(apiDir, 'dist', 'main.js'));
const { MongoClient } = createRequire(join(apiDir, 'package.json'))(
    'mongoose',
).mongo;

function run(args, { input, env } = {}) {
    const child = spawn(process.execPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.stdin.end(input);
    return {
        child,
        done: once(child, 'exit').then(([code]) => ({ code, stdout, stderr })),
    };
}

const bin = (root) => [
    '--data-root',
    root,
    '--mongod',
    MONGOD,
    '--tools',
    TOOLS,
    '--api',
    apiDir,
];
const backup = (command, root, ...extra) =>
    run([
        backupCli,
        command,
        ...(['create', 'verify'].includes(command)
            ? bin(root)
            : ['--data-root', root]),
        ...extra,
    ]).done;
const restoreRun = (root, from, ...extra) =>
    run([restoreCli, ...bin(root), '--from', from, ...extra]).done;

function mongo(password) {
    return new MongoClient(
        `mongodb://127.0.0.1:${PORTS.mongo}/?directConnection=true`,
        {
            auth: { username: DB_USERS.api, password },
            authSource: 'admin',
            serverSelectionTimeoutMS: 5000,
        },
    );
}

async function apiClient(paths) {
    const password = (
        await readFile(paths.secrets.mongoApiPassword, 'utf8')
    ).trim();
    const client = mongo(password);
    await boundedWait(async () => {
        try {
            return (
                (await client.db('admin').command({ hello: 1 }))
                    .isWritablePrimary === true
            );
        } catch {
            return false;
        }
    });
    return client;
}

async function startService(paths) {
    const child = spawn(MONGOD, ['--config', paths.mongodConfig], {
        stdio: 'ignore',
    });
    const client = await apiClient(paths);
    await client.close();
    return child;
}

async function stopService(child) {
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    await once(child, 'exit');
}

function http(path, { method = 'GET', body, cookie } = {}) {
    return new Promise((resolve, reject) => {
        const req = request(
            {
                host: '127.0.0.1',
                port: PORTS.api,
                path,
                method,
                headers: {
                    Host: 'localhost:1443',
                    Origin: ORIGIN,
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                    ...(cookie ? { Cookie: cookie } : {}),
                },
                timeout: 5000,
            },
            (res) => {
                let text = '';
                res.on('data', (d) => (text += d));
                res.on('end', () =>
                    resolve({
                        status: res.statusCode,
                        text,
                        cookie: (res.headers['set-cookie'] ?? [])
                            .map((c) => c.split(';')[0])
                            .join('; '),
                    }),
                );
            },
        );
        req.on('error', reject);
        req.end(body ? JSON.stringify(body) : undefined);
    });
}

async function withApi(paths, fn) {
    const cwd = await mkdtemp(join(tmpdir(), 'gpos-backup-api-'));
    const api = spawn(
        process.execPath,
        [`--env-file=${paths.apiEnv}`, join(apiDir, 'dist', 'main.js')],
        {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
        },
    );
    let logs = '';
    api.stdout.on('data', (d) => (logs += d));
    api.stderr.on('data', (d) => (logs += d));
    try {
        await boundedWait(
            async () => {
                assert.equal(api.exitCode, null, logs);
                try {
                    return (await http('/v1/health/ready')).status === 200;
                } catch {
                    return false;
                }
            },
            { timeoutMs: 60000 },
        );
        return await fn();
    } finally {
        api.kill('SIGINT');
        await once(api, 'exit');
        await rm(cwd, { recursive: true, force: true });
    }
}

/** The domain collections a restore must carry (#363 acceptance list). */
const DOMAIN = [
    'users',
    'sales',
    'salesdetails',
    'shifts',
    'inventories',
    'inventorybatches',
    'stockmovements',
    'auditlogs',
    'settings',
    'offlinecosts',
    'offlineleases',
];

async function digest(client) {
    const db = client.db('grocery');
    const out = {};
    for (const name of DOMAIN) {
        const docs = await db
            .collection(name)
            // Restore and login events are written after a restore, on
            // purpose; compare the store data itself.
            .find(
                name === 'auditlogs'
                    ? {
                          action: {
                              $nin: ['SYSTEM.DATABASE_RESTORED', 'AUTH.LOGIN'],
                          },
                      }
                    : {},
            )
            .sort({ _id: 1 })
            .toArray();
        out[name] = createHash('sha256')
            .update(JSON.stringify(docs))
            .digest('hex');
    }
    return out;
}

function listening(port) {
    return new Promise((done) => {
        const socket = connect({ host: '127.0.0.1', port });
        socket.once('connect', () => {
            socket.destroy();
            done(true);
        });
        socket.once('error', () => done(false));
    });
}

async function rewriteManifest(dir, change) {
    const manifest = JSON.parse(
        await readFile(join(dir, 'manifest.json'), 'utf8'),
    );
    change(manifest);
    const text = JSON.stringify(manifest, null, 2) + '\n';
    await writeFile(join(dir, 'manifest.json'), text);
    await writeFile(
        join(dir, 'manifest.sha256'),
        createHash('sha256').update(text).digest('hex') + '\n',
    );
}

describe(
    'single-pc backup and restore on real MongoDB',
    { skip: !MONGOD || !TOOLS },
    () => {
        let dir;
        let paths;
        let service;
        let exportDir;
        let exported;
        let ownerPassword;

        before(async () => {
            dir = await mkdtemp(join(tmpdir(), 'gpos-backup-db-'));
            paths = layout(join(dir, 'source'));
            exportDir = join(dir, 'usb');
            await mkdir(exportDir);
            const result = await run([
                provisionCli,
                '--data-root',
                paths.root,
                '--mongod',
                MONGOD,
                '--api',
                apiDir,
            ]).done;
            assert.equal(result.code, 0, result.stderr);
            service = await startService(paths);
            if (compiledApi) {
                ownerPassword = randomBytes(18).toString('base64url');
                await withApi(paths, async () => {
                    const r = await run(
                        [
                            `--env-file=${paths.apiEnv}`,
                            join(
                                apiDir,
                                'dist',
                                'bootstrap',
                                'initial-admin.cli.js',
                            ),
                            '--username',
                            'owner',
                            '--password-stdin',
                        ],
                        { input: `${ownerPassword}\n` },
                    ).done;
                    assert.equal(r.code, 0, r.stderr);
                });
            }
            // Seed every domain collection the acceptance list names.
            const client = await apiClient(paths);
            try {
                const db = client.db('grocery');
                for (const name of DOMAIN)
                    await db.collection(name).insertOne({
                        seeded: name,
                        at: new Date('2026-11-01T00:00:00Z'),
                    });
                await db
                    .collection('refreshtokens')
                    .insertOne({ seeded: true });
            } finally {
                await client.close();
            }
        });

        after(async () => {
            await stopService(service);
            await rm(dir, { recursive: true, force: true });
        });

        test('a backup taken under concurrent transactional writes restores one consistent point in time', async () => {
            const client = await apiClient(paths);
            const db = client.db('grocery');
            let seq = 0;
            let stop = false;
            const writer = (async () => {
                while (!stop) {
                    const n = ++seq;
                    const session = client.startSession();
                    try {
                        await session.withTransaction(async () => {
                            await db
                                .collection('probe_sales')
                                .insertOne({ _id: n }, { session });
                            await db
                                .collection('probe_ledger')
                                .insertOne({ _id: n }, { session });
                        });
                    } finally {
                        await session.endSession();
                    }
                }
            })();
            try {
                await boundedWait(async () => seq > 200);
                const result = await backup('create', paths.root);
                assert.equal(result.code, 0, result.stderr);
                assert.ok(seq > 300, 'writes continued during the backup');
            } finally {
                stop = true;
                await writer;
                await client.close();
            }
            const status = JSON.parse(
                (await backup('status', paths.root)).stdout,
            );
            assert.equal(status.backups.length, 1);
            const [only] = status.backups;
            assert.equal(only.verified, true);
            assert.equal(status.lastVerifiedSuccess.backupId, only.backupId);
            assert.equal(status.consecutiveFailures, 0);
            const verification = JSON.parse(
                await readFile(
                    join(
                        paths.dirs.backups,
                        only.backupId,
                        'verification.json',
                    ),
                    'utf8',
                ),
            );
            const { probe_sales: a, probe_ledger: b } =
                verification.collections;
            assert.ok(a > 0, 'the snapshot holds probe writes');
            assert.equal(a, b, 'no half-applied transaction in the snapshot');
            for (const name of DOMAIN)
                assert.ok(verification.collections[name] >= 1, name);
            const manifest = JSON.parse(
                await readFile(
                    join(paths.dirs.backups, only.backupId, 'manifest.json'),
                    'utf8',
                ),
            );
            assert.equal(
                manifest.versions.mongodb.split('.').slice(0, 2).join('.'),
                '7.0',
            );
            assert.ok(
                manifest.contents.included.includes('files/secrets/jwt-secret'),
            );
            if (process.platform !== 'win32') {
                for (const f of manifest.files)
                    assert.equal(
                        (
                            await stat(
                                join(
                                    paths.dirs.backups,
                                    only.backupId,
                                    ...f.path.split('/'),
                                ),
                            )
                        ).mode & 0o077,
                        0,
                        f.path,
                    );
            }
            // No secret leaks into the manifest or status.
            const secret = (
                await readFile(paths.secrets.mongoRootPassword, 'utf8')
            ).trim();
            assert.ok(!JSON.stringify(manifest).includes(secret));
            assert.ok(!JSON.stringify(status).includes(secret));
        });

        test('export copies a verified backup to another destination and refuses unavailable ones', async () => {
            let result = await backup(
                'export',
                paths.root,
                '--to',
                join(dir, 'missing-drive'),
            );
            assert.equal(result.code, 1);
            assert.match(result.stderr, /DESTINATION_UNAVAILABLE/);
            result = await backup('export', paths.root, '--to', exportDir);
            assert.equal(result.code, 1);
            assert.match(result.stderr, /DESTINATION_SAME_DISK/);
            let status = JSON.parse(
                (await backup('status', paths.root)).stdout,
            );
            assert.equal(status.lastFailure.code, 'DESTINATION_SAME_DISK');
            assert.equal(status.exportReminderDue, true);

            // Test-only: CI's temp folder is not removable media.
            result = await run(
                [
                    backupCli,
                    'export',
                    '--data-root',
                    paths.root,
                    '--to',
                    exportDir,
                ],
                { env: { GPOS_TEST_ALLOW_FIXED_DESTINATION: '1' } },
            ).done;
            assert.equal(result.code, 0, result.stderr);
            exported = JSON.parse(
                result.stdout.slice(result.stdout.indexOf('{')),
            ).destination;
            status = JSON.parse((await backup('status', paths.root)).stdout);
            assert.equal(status.lastExport.destination, exported);
            assert.equal(status.exportReminderDue, false);
            assert.equal(status.consecutiveFailures, 0);
            assert.deepEqual(
                (await readdir(exportDir)).filter((n) => n.startsWith('.')),
                [],
                'no partial export left',
            );
            result = await backup('verify', paths.root, '--from', exported);
            assert.equal(result.code, 0, result.stderr);
        });

        test('corrupt, partial and incompatible backups are refused and change nothing', async () => {
            const probe = await apiClient(paths);
            const before = await digest(probe);
            await probe.close();
            const copy = async (name) => {
                const target = join(dir, name);
                await cp(exported, target, { recursive: true });
                return target;
            };
            const flipped = await copy('flipped');
            const archive = join(flipped, 'database.archive.gz');
            const bytes = await readFile(archive);
            bytes[Math.floor(bytes.length / 2)] ^= 0xff;
            await writeFile(archive, bytes);
            const id = JSON.parse(
                await readFile(join(exported, 'manifest.json'), 'utf8'),
            ).backupId;
            let result = await backup('verify', paths.root, '--from', flipped);
            assert.equal(result.code, 1);
            assert.match(result.stderr, /BACKUP_CORRUPT/);
            result = await restoreRun(paths.root, flipped, '--confirm', id);
            assert.equal(result.code, 1);
            assert.match(result.stderr, /BACKUP_CORRUPT/);

            const partial = await copy('partial');
            const full = await readFile(join(partial, 'database.archive.gz'));
            await writeFile(
                join(partial, 'database.archive.gz'),
                full.subarray(0, full.length >> 1),
            );
            result = await restoreRun(paths.root, partial, '--confirm', id);
            assert.equal(result.code, 1);
            assert.match(result.stderr, /BACKUP_CORRUPT/);

            const noManifest = await copy('no-manifest');
            await rm(join(noManifest, 'manifest.sha256'));
            result = await restoreRun(paths.root, noManifest, '--confirm', id);
            assert.equal(result.code, 1);
            assert.match(result.stderr, /BACKUP_CORRUPT/);

            const missingKey = await copy('missing-key');
            await rm(join(missingKey, 'files', 'secrets', 'jwt-secret'));
            result = await restoreRun(paths.root, missingKey, '--confirm', id);
            assert.equal(result.code, 1);
            assert.match(result.stderr, /missing files\/secrets\/jwt-secret/);

            const incompatible = await copy('incompatible');
            await rewriteManifest(
                incompatible,
                (m) => (m.versions.mongodb = '8.0.4'),
            );
            result = await restoreRun(
                paths.root,
                incompatible,
                '--confirm',
                id,
            );
            assert.equal(result.code, 3);
            assert.match(
                result.stderr,
                /Incompatible backup: backup is from MongoDB 8\.0\.4/,
            );
            const newerApp = await copy('newer-app');
            await rewriteManifest(newerApp, (m) => (m.versions.app = '99.0.0'));
            result = await restoreRun(paths.root, newerApp, '--confirm', id);
            assert.equal(result.code, 3);
            assert.match(result.stderr, /newer than this installation/);

            // Without the exact confirmation nothing happens.
            result = await restoreRun(paths.root, exported, '--confirm', 'yes');
            assert.equal(result.code, 3);
            result = await restoreRun(
                paths.root,
                exported,
                '--confirm',
                id.replace(/[0-9a-f]{6}$/, '000000'),
            );
            assert.equal(result.code, 3);
            assert.match(result.stderr, /--confirm/);

            const client = await apiClient(paths);
            try {
                assert.deepEqual(await digest(client), before);
            } finally {
                await client.close();
            }
        });

        test('low disk and an interrupted backup are failures, never successes, and recover', async () => {
            const status0 = JSON.parse(
                (await backup('status', paths.root)).stdout,
            );
            let result = await backup(
                'create',
                paths.root,
                '--reserve-mb',
                String(1024 * 1024),
            );
            assert.equal(result.code, 1);
            assert.match(result.stderr, /LOW_DISK/);
            let status = JSON.parse(
                (await backup('status', paths.root)).stdout,
            );
            assert.equal(status.lastFailure.code, 'LOW_DISK');
            assert.equal(
                status.consecutiveFailures,
                status0.consecutiveFailures + 1,
            );
            assert.deepEqual(
                status.lastVerifiedSuccess,
                status0.lastVerifiedSuccess,
            );

            // Kill one run while it dumps and another while its test restore runs.
            const scratchPort = async () => {
                for (const n of await readdir(paths.dirs.backups)) {
                    if (!n.startsWith('.verify-')) continue;
                    // {port, credential}: the instance requires auth.
                    const port = await readFile(
                        join(paths.dirs.backups, n, 'port'),
                        'utf8',
                    ).then(
                        (t) => JSON.parse(t).port,
                        () => 0,
                    );
                    if (port && (await listening(port))) return port;
                }
                return 0;
            };
            let orphanPort = 0;
            for (const phase of ['dump', 'verify']) {
                const killed = run([backupCli, 'create', ...bin(paths.root)]);
                await boundedWait(
                    async () =>
                        phase === 'dump'
                            ? (await readdir(paths.dirs.backups)).some((n) =>
                                  n.startsWith('.incomplete-'),
                              )
                            : (orphanPort = await scratchPort()) > 0,
                    { intervalMs: 5 },
                );
                killed.child.kill('SIGKILL');
                await killed.done;
                status = JSON.parse(
                    (await backup('status', paths.root)).stdout,
                );
                assert.deepEqual(
                    status.lastVerifiedSuccess,
                    status0.lastVerifiedSuccess,
                    `killed in ${phase}: not a success`,
                );
                assert.equal(
                    status.backups.filter((b) => b.verified).length,
                    1,
                );
            }
            assert.equal(
                await listening(orphanPort),
                true,
                'the killed run left its test mongod',
            );

            result = await backup('create', paths.root);
            assert.equal(result.code, 0, result.stderr);
            assert.match(result.stdout, /removed interrupted/);
            assert.equal(
                await listening(orphanPort),
                false,
                'the leftover test mongod was stopped',
            );
            status = JSON.parse((await backup('status', paths.root)).stdout);
            assert.equal(status.backups.filter((b) => b.verified).length, 2);
            assert.equal(status.consecutiveFailures, 0);
            const left = (await readdir(paths.dirs.backups)).filter((n) =>
                n.startsWith('.'),
            );
            assert.deepEqual(
                left,
                [],
                JSON.stringify({
                    out: result.stdout,
                    files: await Promise.all(
                        left.map((n) =>
                            readdir(join(paths.dirs.backups, n), {
                                recursive: true,
                            }),
                        ),
                    ),
                }),
            );
        });

        test('in-place restore refuses data loss unless accepted, then keeps a safety backup', async () => {
            const id = JSON.parse(
                await readFile(join(exported, 'manifest.json'), 'utf8'),
            ).backupId;
            const client = await apiClient(paths);
            try {
                const db = client.db('grocery');
                await db
                    .collection('shifts')
                    .insertOne({ status: 'OPEN', late: true });
                await db
                    .collection('offlineleases')
                    .insertOne({ active: true, late: true });
                await db
                    .collection('sales')
                    .insertOne({ createdAt: new Date(), late: true });
            } finally {
                await client.close();
            }
            // A signed-in session from before the restore.
            let oldCookie;
            if (compiledApi)
                await withApi(paths, async () => {
                    const login = await http('/v1/auth/login', {
                        method: 'POST',
                        body: { username: 'owner', password: ownerPassword },
                    });
                    assert.ok([200, 201].includes(login.status), login.text);
                    oldCookie = login.cookie;
                    assert.equal(
                        (await http('/v1/users/profile', { cookie: oldCookie }))
                            .status,
                        200,
                    );
                });
            const jwtBefore = await readFile(paths.secrets.jwtSecret, 'utf8');
            const cookieBefore = await readFile(
                paths.secrets.cookieSecret,
                'utf8',
            );
            let result = await restoreRun(
                paths.root,
                exported,
                '--confirm',
                id,
            );
            assert.equal(result.code, 3);
            assert.match(result.stderr, /1 shift\(s\) are open/);
            assert.match(result.stderr, /offline cash leases/);
            assert.match(result.stderr, /recorded after this backup/);

            result = await restoreRun(
                paths.root,
                exported,
                '--confirm',
                id,
                '--accept-open-shifts',
                '--accept-newer-sales',
                '--accept-pending-offline',
            );
            assert.equal(result.code, 0, result.stderr);
            const summary = JSON.parse(
                result.stdout.slice(result.stdout.indexOf('{\n')),
            );
            assert.match(summary.safetyBackupId, /-pre-restore-/);
            const after = await apiClient(paths);
            try {
                const db = after.db('grocery');
                assert.equal(
                    await db.collection('sales').countDocuments({ late: true }),
                    0,
                );
                assert.equal(
                    await db
                        .collection('shifts')
                        .countDocuments({ late: true }),
                    0,
                );
                assert.equal(
                    await db.collection('refreshtokens').countDocuments({}),
                    0,
                    'sessions revoked',
                );
                // Leases are kept, but none has a live session family any
                // more: their queued cash needs ADMIN reconciliation (#37;
                // apps/api/test/db/offline.db-spec.ts proves the API side).
                assert.ok(
                    (await db.collection('offlineleases').countDocuments({})) >
                        0,
                );
                const [audit] = await db
                    .collection('auditlogs')
                    .find({ action: 'SYSTEM.DATABASE_RESTORED' })
                    .toArray();
                assert.equal(audit.actor, null);
                assert.equal(audit.targetModel, 'Database');
                // The API's own audit collection (the bootstrap entry is there).
                if (compiledApi)
                    assert.equal(
                        await db.collection('auditlogs').countDocuments({
                            action: 'SYSTEM.INITIAL_ADMIN_CREATED',
                        }),
                        1,
                    );
                assert.deepEqual(audit.after, {
                    backupId: id,
                    backupCreatedAt: JSON.parse(
                        await readFile(join(exported, 'manifest.json'), 'utf8'),
                    ).createdAt,
                    safetyBackupId: summary.safetyBackupId,
                    replacementInstallation: false,
                    acceptOpenShifts: true,
                    acceptNewerSales: true,
                    acceptPendingOffline: true,
                    source: 'restore.mjs',
                });
                const a = await db
                    .collection('probe_sales')
                    .find()
                    .sort({ _id: 1 })
                    .toArray();
                const b = await db
                    .collection('probe_ledger')
                    .find()
                    .sort({ _id: 1 })
                    .toArray();
                assert.deepEqual(a, b);
                assert.deepEqual(
                    a.map((d) => d._id),
                    a.map((_, i) => i + 1),
                    'a contiguous prefix of the committed writes',
                );
            } finally {
                await after.close();
            }
            // Sessions end: a new cookie secret, the offline JWT secret kept.
            assert.equal(
                await readFile(paths.secrets.jwtSecret, 'utf8'),
                jwtBefore,
            );
            const cookieAfter = (
                await readFile(paths.secrets.cookieSecret, 'utf8')
            ).trim();
            assert.notEqual(cookieAfter, cookieBefore.trim());
            assert.ok(
                (await readFile(paths.apiEnv, 'utf8')).includes(
                    `COOKIE_SECRET=${cookieAfter}\n`,
                ),
            );
            if (compiledApi)
                await withApi(paths, async () => {
                    assert.equal(
                        (await http('/v1/users/profile', { cookie: oldCookie }))
                            .status,
                        401,
                        'a pre-restore access token no longer works',
                    );
                    const login = await http('/v1/auth/login', {
                        method: 'POST',
                        body: { username: 'owner', password: ownerPassword },
                    });
                    assert.ok([200, 201].includes(login.status), login.text);
                });
            const status = JSON.parse(
                (await backup('status', paths.root)).stdout,
            );
            assert.equal(status.lastRestore.backupId, id);
            const safety = status.backups.find(
                (b) => b.backupId === summary.safetyBackupId,
            );
            assert.equal(
                safety?.verified,
                true,
                'the safety backup is verified',
            );
        });

        test('restoring a backup older than 30 days never prunes it', async () => {
            const oldId = '20250101T000000Z-manual-0a0b0c';
            const old = join(paths.dirs.backups, oldId);
            await cp(exported, old, { recursive: true });
            await rewriteManifest(old, (m) => {
                m.backupId = oldId;
                m.createdAt = '2025-01-01T00:00:00.000Z';
            });
            const verification = JSON.parse(
                await readFile(join(old, 'verification.json'), 'utf8'),
            );
            await writeFile(
                join(old, 'verification.json'),
                JSON.stringify({ ...verification, backupId: oldId }),
            );
            let status = JSON.parse(
                (await backup('status', paths.root)).stdout,
            );
            assert.ok(
                status.backups.filter((b) => b.verified).length > 1 &&
                    status.backups.find((b) => b.backupId === oldId)?.verified,
                'not the newest verified backup, so retention would choose it',
            );
            const result = await restoreRun(
                paths.root,
                old,
                '--confirm',
                oldId,
                '--accept-newer-sales',
                '--accept-open-shifts',
                '--accept-pending-offline',
            );
            assert.equal(result.code, 0, result.stderr);
            assert.ok(existsSync(join(old, 'database.archive.gz')));
            status = JSON.parse((await backup('status', paths.root)).stdout);
            assert.equal(
                status.backups.find((b) => b.backupId === oldId)?.verified,
                true,
            );
            // An ordinary create afterwards applies retention to it as usual.
            const create = await backup('create', paths.root);
            assert.equal(create.code, 0, create.stderr);
            assert.ok(!existsSync(old));
        });

        test('a replacement PC restores onto an empty data root and the restored owner can log in', async () => {
            const id = JSON.parse(
                await readFile(join(exported, 'manifest.json'), 'utf8'),
            ).backupId;
            const source = await apiClient(paths);
            const expected = await digest(source);
            await source.close();
            await stopService(service);
            service = undefined;

            const target = layout(join(dir, 'replacement'));
            const result = await restoreRun(
                target.root,
                exported,
                '--confirm',
                id,
            );
            assert.equal(result.code, 0, result.stderr);
            assert.match(result.stdout, /"replacementInstallation": true/);
            assert.equal(
                JSON.parse(await readFile(target.install, 'utf8'))
                    .installationId,
                JSON.parse(await readFile(paths.install, 'utf8'))
                    .installationId,
            );
            service = await startService(target);
            const client = await apiClient(target);
            try {
                assert.deepEqual(await digest(client), expected);
            } finally {
                await client.close();
            }
            if (compiledApi) {
                await withApi(target, async () => {
                    const login = await http('/v1/auth/login', {
                        method: 'POST',
                        body: { username: 'owner', password: ownerPassword },
                    });
                    assert.ok([200, 201].includes(login.status), login.text);
                });
            }
            // The replacement can back itself up straight away.
            const again = await backup('create', target.root);
            assert.equal(again.code, 0, again.stderr);
        });
    },
);
