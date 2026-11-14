// Real-MongoDB provisioning checks (#360). Needs a MongoDB 7 `mongod`
// binary (GPOS_TEST_MONGOD) and free loopback ports 27018/13000; skipped
// otherwise. With a built API (apps/api/dist) it also boots the compiled
// API on the generated env file and bootstraps/logs in the first ADMIN.
//   GPOS_TEST_MONGOD=/path/to/mongod node --test packaging/single-pc/runtime/provision.db.test.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import {
    mkdtemp,
    readFile,
    readdir,
    rm,
    stat,
    writeFile,
} from 'node:fs/promises';
import { request } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { boundedWait } from '../proof/policy.mjs';
import { DB_USERS, ORIGIN, PORTS, layout } from './layout.mjs';

const MONGOD = process.env.GPOS_TEST_MONGOD;
const repo = fileURLToPath(new URL('../../..', import.meta.url));
const apiDir = join(repo, 'apps', 'api');
const cli = fileURLToPath(new URL('./provision.mjs', import.meta.url));
const { MongoClient } = createRequire(join(apiDir, 'package.json'))(
    'mongoose',
).mongo;

function run(args, { input } = {}) {
    const child = spawn(process.execPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
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

const provisionArgs = (root) => [
    cli,
    '--data-root',
    root,
    '--mongod',
    MONGOD,
    '--api',
    apiDir,
];

async function startService(paths) {
    const child = spawn(MONGOD, ['--config', paths.mongodConfig], {
        stdio: 'ignore',
    });
    await boundedWait(async () => {
        assert.equal(child.exitCode, null, 'mongod exited');
        const c = mongo();
        try {
            await c.connect();
            return true;
        } catch {
            return false;
        } finally {
            await c.close();
        }
    });
    return child;
}

async function stopService(child) {
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    await once(child, 'exit');
}

function mongo(auth) {
    return new MongoClient(
        `mongodb://127.0.0.1:${PORTS.mongo}/?directConnection=true`,
        { auth, authSource: 'admin', serverSelectionTimeoutMS: 3000 },
    );
}

async function secretsDigest(paths) {
    const hash = createHash('sha256');
    for (const path of Object.values(paths.secrets))
        hash.update(await readFile(path));
    return hash.digest('hex');
}

/** Listening TCP sockets on a port from /proc (Linux only). */
async function listeners(port) {
    const hex = port.toString(16).toUpperCase().padStart(4, '0');
    const found = [];
    for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
        const text = await readFile(file, 'utf8').catch(() => '');
        for (const line of text.split('\n').slice(1)) {
            const [, local, , st] = line.trim().split(/\s+/);
            if (st === '0A' && local?.endsWith(`:${hex}`))
                found.push(local.split(':')[0]);
        }
    }
    return found;
}

function http(path, { method = 'GET', body, headers = {} } = {}) {
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
                    ...headers,
                },
                timeout: 5000,
            },
            (res) => {
                let text = '';
                res.on('data', (d) => (text += d));
                res.on('end', () =>
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        text,
                    }),
                );
            },
        );
        req.on('error', reject);
        req.end(body ? JSON.stringify(body) : undefined);
    });
}

describe(
    'single-pc runtime provisioning on real MongoDB',
    { skip: !MONGOD },
    () => {
        let dir;
        let root;
        let paths;
        let service;

        before(async () => {
            dir = await mkdtemp(join(tmpdir(), 'gpos-runtime-db-'));
            root = join(dir, 'GroceryPOS');
            paths = layout(root);
        });
        after(async () => {
            await stopService(service);
            await rm(dir, { recursive: true, force: true });
        });

        test('fresh initialization creates owner-only secrets and a complete journal', async () => {
            const { code, stdout, stderr } = await run(provisionArgs(root))
                .done;
            assert.equal(code, 0, stderr);
            assert.match(stdout, /"complete":true/);
            const journal = JSON.parse(await readFile(paths.journal, 'utf8'));
            assert.deepEqual(Object.keys(journal.stages), [
                'layout',
                'secrets',
                'database',
                'config',
            ]);
            if (process.platform !== 'win32') {
                assert.equal((await stat(root)).mode & 0o777, 0o700);
                for (const name of ['secrets', 'database', 'tls', 'state'])
                    assert.equal(
                        (await stat(paths.dirs[name])).mode & 0o077,
                        0,
                    );
                for (const path of [
                    ...Object.values(paths.secrets),
                    paths.apiEnv,
                ])
                    assert.equal((await stat(path)).mode & 0o777, 0o600);
            }
            // No secret reaches the output or non-secret files.
            const env = await readFile(paths.apiEnv, 'utf8');
            const password = await readFile(
                paths.secrets.mongoApiPassword,
                'utf8',
            );
            assert.ok(env.includes(password));
            for (const text of [
                stdout,
                stderr,
                await readFile(paths.runtimeManifest, 'utf8'),
                await readFile(paths.mongodConfig, 'utf8'),
            ])
                assert.ok(!text.includes(password));
            // The provisioning mongod was stopped.
            assert.deepEqual(await listeners(PORTS.mongo), []);
        });

        test('the database binds loopback only, refuses anonymous access and runs transactions', async () => {
            service = await startService(paths);
            if (process.platform === 'linux')
                assert.deepEqual(await listeners(PORTS.mongo), ['0100007F']);

            const anon = mongo();
            try {
                await assert.rejects(
                    anon.db('grocery').collection('users').findOne({}),
                    (error) => error.code === 13,
                );
            } finally {
                await anon.close();
            }
            const wrong = mongo({ username: DB_USERS.api, password: 'wrong' });
            await assert.rejects(
                wrong.connect(),
                (e) => e.code === 18 || /Authentication failed/.test(e.message),
            );
            await wrong.close();

            const password = (
                await readFile(paths.secrets.mongoApiPassword, 'utf8')
            ).trim();
            const app = mongo({ username: DB_USERS.api, password });
            try {
                await app.connect();
                assert.equal(
                    (await app.db('admin').command({ hello: 1 }))
                        .isWritablePrimary,
                    true,
                );
                const collection = app
                    .db('grocery')
                    .collection('runtime_probe');
                await collection.insertOne({ _id: 'persisted' });
                const session = app.startSession();
                try {
                    await session.withTransaction(async () => {
                        await collection.insertOne({ _id: 'tx' }, { session });
                    });
                    await assert.rejects(
                        session.withTransaction(async () => {
                            await collection.insertOne(
                                { _id: 'rolled-back' },
                                { session },
                            );
                            throw new Error('rollback');
                        }),
                        /rollback/,
                    );
                } finally {
                    await session.endSession();
                }
                assert.ok(await collection.findOne({ _id: 'tx' }));
                assert.equal(
                    await collection.findOne({ _id: 'rolled-back' }),
                    null,
                );
                // Least privilege: no other database, no user administration.
                await assert.rejects(
                    app.db('other').collection('x').insertOne({}),
                    (e) => e.code === 13,
                );
                await assert.rejects(
                    app.db('admin').command({ usersInfo: 1 }),
                    (e) => e.code === 13,
                );
            } finally {
                await app.close();
            }
        });

        test('repeat initialization while the service runs reuses it and keeps secrets', async () => {
            const before = await secretsDigest(paths);
            const install = await readFile(paths.install, 'utf8');
            const { code, stdout, stderr } = await run(provisionArgs(root))
                .done;
            assert.equal(code, 0, stderr);
            assert.match(stdout, /using this installation's running database/);
            assert.equal(service.exitCode, null, 'service left running');
            assert.equal(await secretsDigest(paths), before);
            assert.equal(await readFile(paths.install, 'utf8'), install);
        });

        test('restart keeps data; a repeat run with the service stopped is unchanged', async () => {
            await stopService(service);
            const before = await secretsDigest(paths);
            const { code, stderr } = await run(provisionArgs(root)).done;
            assert.equal(code, 0, stderr);
            assert.equal(await secretsDigest(paths), before);
            service = await startService(paths);
            const password = (
                await readFile(paths.secrets.mongoApiPassword, 'utf8')
            ).trim();
            const app = mongo({ username: DB_USERS.api, password });
            try {
                await boundedWait(
                    async () =>
                        (await app.db('admin').command({ hello: 1 }))
                            .isWritablePrimary === true,
                );
                assert.ok(
                    await app
                        .db('grocery')
                        .collection('runtime_probe')
                        .findOne({ _id: 'persisted' }),
                );
            } finally {
                await app.close();
            }
        });

        test(
            'the compiled API waits for the database, serves health and bootstraps the first ADMIN',
            { skip: !existsSync(join(apiDir, 'dist', 'main.js')) },
            async () => {
                const cwd = await mkdtemp(join(dir, 'api-cwd-'));
                const api = spawn(
                    process.execPath,
                    [
                        `--env-file=${paths.apiEnv}`,
                        join(apiDir, 'dist', 'main.js'),
                    ],
                    { cwd, stdio: ['ignore', 'pipe', 'pipe'] },
                );
                let logs = '';
                api.stdout.on('data', (d) => (logs += d));
                api.stderr.on('data', (d) => (logs += d));
                try {
                    await boundedWait(
                        async () => {
                            assert.equal(api.exitCode, null, logs);
                            try {
                                return (
                                    (await http('/v1/health/ready')).status ===
                                    200
                                );
                            } catch {
                                return false;
                            }
                        },
                        { timeoutMs: 60000 },
                    );
                    if (process.platform === 'linux')
                        assert.deepEqual(await listeners(PORTS.api), [
                            '0100007F',
                        ]);
                    const password = randomBytes(18).toString('base64url');
                    const bootstrap = run(
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
                        { input: `${password}\n` },
                    );
                    const result = await bootstrap.done;
                    assert.equal(result.code, 0, result.stderr);
                    const login = await http('/v1/auth/login', {
                        method: 'POST',
                        body: { username: 'owner', password },
                    });
                    assert.ok([200, 201].includes(login.status), login.text);
                    assert.equal(JSON.parse(login.text).user.username, 'owner');
                    assert.ok(login.headers['set-cookie']?.length);
                    // No secret in the API's own output.
                    const secret = (
                        await readFile(paths.secrets.mongoApiPassword, 'utf8')
                    ).trim();
                    assert.ok(!logs.includes(secret));
                } finally {
                    api.kill('SIGINT');
                    await once(api, 'exit');
                }
            },
        );

        test('foreign, damaged and lost-secret states are refused unchanged', async () => {
            await stopService(service);
            service = undefined;
            // A lost secret after initialization: never regenerated.
            const keep = await readFile(paths.secrets.mongoRootPassword);
            await rm(paths.secrets.mongoRootPassword);
            let result = await run(provisionArgs(root)).done;
            assert.equal(result.code, 3);
            assert.match(result.stderr, /restore it from a backup/);
            await writeFile(paths.secrets.mongoRootPassword, keep, {
                mode: 0o600,
            });

            // Another installation's identity over this database.
            const install = await readFile(paths.install, 'utf8');
            await writeFile(
                paths.install,
                install.replace(
                    /"installationId": "[^"]+"/,
                    '"installationId": "other"',
                ),
            );
            result = await run(provisionArgs(root)).done;
            assert.equal(result.code, 3, result.stderr);
            assert.match(result.stderr, /another installation/);
            await writeFile(paths.install, install);
            assert.deepEqual(await listeners(PORTS.mongo), []);

            // Something else on the database port.
            const other = await mkdtemp(join(dir, 'other-'));
            const squatter = spawn(
                MONGOD,
                [
                    '--dbpath',
                    other,
                    '--bind_ip',
                    '127.0.0.1',
                    '--port',
                    String(PORTS.mongo),
                ],
                { stdio: 'ignore' },
            );
            try {
                await boundedWait(
                    async () =>
                        (await listeners(PORTS.mongo)).length > 0 ||
                        process.platform !== 'linux',
                );
                await new Promise((r) => setTimeout(r, 500));
                result = await run(provisionArgs(root)).done;
                assert.equal(result.code, 3, result.stderr);
                assert.match(result.stderr, /not provably this installation/);
            } finally {
                await stopService(squatter);
            }
            result = await run(provisionArgs(root)).done;
            assert.equal(result.code, 0, result.stderr);
        });

        test('an interrupted fresh initialization resumes without resetting', async () => {
            const fresh = join(dir, 'Interrupted');
            const freshPaths = layout(fresh);
            const attempt = run(provisionArgs(fresh));
            // Kill it once the database work has started.
            await boundedWait(
                async () => {
                    const text = await readFile(
                        freshPaths.journal,
                        'utf8',
                    ).catch(() => '');
                    return (
                        text.includes('"secrets"') ||
                        attempt.child.exitCode !== null
                    );
                },
                { intervalMs: 5 },
            );
            attempt.child.kill('SIGKILL');
            await attempt.done;
            const secretsBefore = await secretsDigest(freshPaths);
            // Its mongod may have survived: the next run refuses until it stops.
            const pid = Number(
                await readFile(freshPaths.mongodPid, 'utf8').catch(() => 'NaN'),
            );
            if (Number.isSafeInteger(pid)) {
                let result = await run(provisionArgs(fresh)).done;
                if (result.code === 3)
                    assert.match(result.stderr, /mongod\.pid/);
                try {
                    process.kill(pid, 'SIGTERM');
                } catch {
                    // already gone
                }
                await boundedWait(
                    async () => (await listeners(PORTS.mongo)).length === 0,
                );
            }
            const { code, stderr } = await run(provisionArgs(fresh)).done;
            assert.equal(code, 0, stderr);
            assert.equal(await secretsDigest(freshPaths), secretsBefore);
            assert.ok(
                !(await readdir(freshPaths.dirs.state)).includes(
                    'provision.lock',
                ),
            );
        });
    },
);
