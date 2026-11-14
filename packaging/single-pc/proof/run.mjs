// Architecture proof only. Never point this tool at an installed database.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { cpus, freemem, tmpdir, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import {
    assertWindows11,
    boundedWait,
    components,
    parseArgs,
    sha256,
    verifyArchive,
} from './policy.mjs';

function powershell(script, extraEnv = {}) {
    return execFileSync(
        'powershell.exe',
        [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `$ErrorActionPreference='Stop'; ${script}`,
        ],
        {
            env: { ...process.env, ...extraEnv },
            encoding: 'utf8',
            timeout: 30000,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        },
    ).trim();
}

async function findBinary(root, name) {
    const found = [];
    async function walk(dir) {
        for (const item of await readdir(dir, { withFileTypes: true })) {
            const path = join(dir, item.name);
            if (item.isDirectory()) await walk(path);
            else if (item.name === name) found.push(path);
        }
    }
    await walk(root);
    assert.equal(found.length, 1, 'Expected exactly one runtime executable.');
    return found[0];
}

async function unusedPort() {
    const server = createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    await new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
    );
    return port;
}

async function proveApi(apiPath, env, password) {
    // Load only compiled production code and artifact-local dependencies.
    Object.assign(process.env, env);
    const fromApi = createRequire(join(apiPath, 'package.json'));
    const { NestFactory } = fromApi('@nestjs/core');
    const { VersioningType } = fromApi('@nestjs/common');
    const { AppModule } = fromApi(join(apiPath, 'dist/app.module.js'));
    const { createValidationPipe } = fromApi(
        join(apiPath, 'dist/common/pipes/validation.pipe.js'),
    );
    const { useBodyParsers } = fromApi(
        join(apiPath, 'dist/common/body-parsers.js'),
    );
    const app = await NestFactory.create(AppModule, {
        logger: false,
        bodyParser: false,
        abortOnError: false,
    });
    try {
        app.use(fromApi('helmet')());
        app.useGlobalPipes(createValidationPipe());
        app.use(fromApi('cookie-parser')(env.COOKIE_SECRET));
        app.enableVersioning({ defaultVersion: '1', type: VersioningType.URI });
        useBodyParsers(app);
        await app.listen(0, '127.0.0.1');
        const origin = await app.getUrl();
        const request = (path, options = {}) =>
            fetch(`${origin}/v1${path}`, {
                ...options,
                signal: AbortSignal.timeout(10000),
            });
        assert.equal((await request('/users/profile')).status, 401);
        assert.equal((await request('/health/ready')).status, 200);
        const login = await request('/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'proofadmin', password }),
        });
        assert.equal(login.status, 201);
        assert.equal((await login.json()).user.username, 'proofadmin');
        const cookies = login.headers
            .getSetCookie()
            .map((cookie) => cookie.split(';')[0])
            .join('; ');
        assert.ok(cookies.includes('jwt='));
        const profile = await request('/users/profile', {
            headers: { Cookie: cookies },
        });
        assert.equal(profile.status, 200);
        assert.equal((await profile.json()).username, 'proofadmin');
        return {
            compiledAppModuleLogin: true,
            authenticatedProfile: true,
            anonymousProfileRefused: true,
            dbReady: true,
        };
    } finally {
        await app.close();
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    // Refuse before creating state, starting processes or touching an artifact.
    if (process.platform !== 'win32' || process.arch !== 'x64') {
        throw new Error('Actual Windows 11 Intel/AMD x64 is required.');
    }
    const os = JSON.parse(
        powershell(
            `$o=Get-CimInstance Win32_OperatingSystem; $c=Get-CimInstance Win32_Processor | Select-Object -First 1; @{caption=$o.Caption; productType=[int]$o.ProductType; build=[int]$o.BuildNumber; cpu=$c.Manufacturer; cpuModel=$c.Name; windowsVersion=(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion').DisplayVersion} | ConvertTo-Json -Compress`,
        ),
    );
    assertWindows11({ platform: process.platform, arch: process.arch, ...os });
    const pins = await components();
    assert.equal(
        process.versions.node,
        pins.node.version,
        'Run with the pinned extracted Node.',
    );
    const api = resolve(args.api);
    const output = resolve(args.output);
    // Existing output must never become misleading evidence for a failed rerun.
    await assert.rejects(stat(output), (error) => error.code === 'ENOENT');
    await verifyArchive(resolve(args['node-archive']), pins.node.sha256);
    await verifyArchive(resolve(args['mongo-archive']), pins.mongodb.sha256);
    const fromApi = createRequire(join(api, 'package.json'));
    assert.equal(fromApi('argon2/package.json').version, pins.argon2.version);
    assert.equal((await stat(join(api, 'dist/main.js'))).isFile(), true);
    await assert.rejects(
        stat(join(api, 'src')),
        (error) => error.code === 'ENOENT',
    );
    const root = await mkdtemp(join(tmpdir(), 'gpos_archproof_'));
    let mongo;
    let mongoDone = Promise.resolve();
    let dbClient;
    let adminClient;
    let report;
    try {
        powershell(
            `$u=[Security.Principal.WindowsIdentity]::GetCurrent().Name; & icacls.exe $env:GPOS_PROOF_ROOT /inheritance:r /grant:r ($u+':(OI)(CI)F') | Out-Null; if($LASTEXITCODE -ne 0){throw 'ACL failed'}`,
            { GPOS_PROOF_ROOT: root },
        );
        for (const [name, archive] of [
            ['node', args['node-archive']],
            ['mongo', args['mongo-archive']],
        ]) {
            powershell(
                'Expand-Archive -LiteralPath $env:GPOS_ARCHIVE -DestinationPath $env:GPOS_EXTRACT',
                {
                    GPOS_ARCHIVE: resolve(archive),
                    GPOS_EXTRACT: join(root, name),
                },
            );
        }
        const node = await findBinary(join(root, 'node'), 'node.exe');
        assert.equal(
            await sha256(process.execPath),
            await sha256(node),
            'Executing Node must match verified archive.',
        );
        const mongod = await findBinary(join(root, 'mongo'), 'mongod.exe');
        const mongoVersion = /db version v(\d+\.\d+\.\d+)/.exec(
            execFileSync(mongod, ['--version'], {
                encoding: 'utf8',
                timeout: 10000,
            }),
        )?.[1];
        assert.equal(mongoVersion, pins.mongodb.version);
        const port = await unusedPort();
        const data = join(root, 'data');
        await mkdir(data);
        const key = join(root, 'rs.key');
        await writeFile(key, randomBytes(756).toString('base64'), {
            flag: 'wx',
        });
        const config = join(root, 'mongod.json');
        await writeFile(
            config,
            JSON.stringify({
                storage: {
                    dbPath: data,
                    wiredTiger: { engineConfig: { cacheSizeGB: 0.25 } },
                },
                systemLog: {
                    destination: 'file',
                    path: join(root, 'mongo.log'),
                },
                net: { bindIp: '127.0.0.1', port },
                replication: { replSetName: 'gposProof' },
                security: { authorization: 'enabled', keyFile: key },
            }),
            { flag: 'wx' },
        );
        mongo = spawn(mongod, ['--config', config], {
            stdio: 'ignore',
            windowsHide: true,
        });
        mongoDone = new Promise((resolve) => {
            mongo.once('exit', resolve);
            mongo.once('error', resolve);
        });
        let spawnError = false;
        mongo.on('error', () => {
            spawnError = true;
        });
        // An unused-port check alone is racy. Verify our child's ownership before
        // using localhost-exception commands; never connect to a preexisting DB.
        await boundedWait(async () => {
            assert.ok(
                !spawnError && mongo.exitCode === null,
                'Proof database exited.',
            );
            return (
                powershell(
                    `$c=Get-NetTCPConnection -LocalPort $env:GPOS_PORT -State Listen -ErrorAction SilentlyContinue; if($c){if(@($c).Count -ne 1 -or $c.LocalAddress -ne '127.0.0.1' -or $c.OwningProcess -ne [int]$env:GPOS_PID){throw 'Unexpected listener'}; 'owned'}`,
                    { GPOS_PORT: String(port), GPOS_PID: String(mongo.pid) },
                ) === 'owned'
            );
        });
        const { MongoClient } = fromApi('mongoose').mongo;
        const address = `mongodb://127.0.0.1:${port}/?directConnection=true`;
        const connect = (auth) =>
            new MongoClient(address, {
                auth,
                authSource: 'admin',
                serverSelectionTimeoutMS: 1500,
                connectTimeoutMS: 1500,
                socketTimeoutMS: 3000,
            });
        const first = connect();
        try {
            await first.connect();
            await first.db('admin').command({
                replSetInitiate: {
                    _id: 'gposProof',
                    members: [{ _id: 0, host: `127.0.0.1:${port}` }],
                },
            });
            await boundedWait(
                async () =>
                    (await first.db('admin').command({ hello: 1 }))
                        .isWritablePrimary === true,
            );
            const adminPassword = randomBytes(48).toString('base64url');
            await first.db('admin').command({
                createUser: 'proofroot',
                pwd: adminPassword,
                roles: ['root'],
            });
            adminClient = connect({
                username: 'proofroot',
                password: adminPassword,
            });
            await adminClient.connect();
        } finally {
            await first.close();
        }
        const dbName = `gpos_archproof_${randomUUID().replaceAll('-', '')}`;
        const dbPassword = randomBytes(48).toString('base64url');
        await adminClient.db('admin').command({
            createUser: 'proofapp',
            pwd: dbPassword,
            roles: [{ role: 'readWrite', db: dbName }],
        });
        dbClient = connect({ username: 'proofapp', password: dbPassword });
        await dbClient.connect();
        const db = dbClient.db(dbName);
        assert.equal(
            (await dbClient.db('admin').command({ hello: 1 }))
                .isWritablePrimary,
            true,
        );
        const unauthorized = connect();
        try {
            await assert.rejects(
                unauthorized.db(dbName).collection('proof').findOne({}),
                (error) => error.code === 13,
            );
        } finally {
            await unauthorized.close();
        }
        const collection = db.collection('proof');
        await db.createCollection('proof');
        const session = dbClient.startSession();
        try {
            await session.withTransaction(async () => {
                await collection.insertOne({ _id: 'committed' }, { session });
            });
            await assert.rejects(
                session.withTransaction(async () => {
                    await collection.insertOne(
                        { _id: 'rolled-back' },
                        { session },
                    );
                    throw new Error('intentional rollback');
                }),
                /intentional rollback/,
            );
        } finally {
            await session.endSession();
        }
        assert.ok(await collection.findOne({ _id: 'committed' }));
        assert.equal(await collection.findOne({ _id: 'rolled-back' }), null);
        const argon2 = fromApi('argon2');
        const password = randomBytes(32).toString('base64url');
        const started = performance.now();
        const hash = await argon2.hash(password);
        assert.equal(await argon2.verify(hash, password), true);
        assert.equal(await argon2.verify(hash, `${password}wrong`), false);
        const passwordProofMs = Math.round(performance.now() - started);
        // Synthetic account in this tool's newly created DB only. This is not
        // customer bootstrap (#361) or a shortcut around first-login policy.
        await db.collection('users').insertOne({
            name: 'proofadmin',
            roles: ['ADMIN'],
            isActive: true,
            passwordHash: hash,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        const apiEvidence = await proveApi(
            api,
            {
                APP_ENV: 'prod',
                NODE_ENV: 'production',
                PORT: '13000',
                DATABASE_URL: `mongodb://proofapp:${dbPassword}@127.0.0.1:${port}/${dbName}?authSource=admin&directConnection=true&serverSelectionTimeoutMS=1500&connectTimeoutMS=1500&socketTimeoutMS=3000`,
                FRONTEND_URL: 'https://localhost:1443',
                DOMAIN: 'localhost',
                JWT_SECRET: randomBytes(48).toString('base64'),
                COOKIE_SECRET: randomBytes(48).toString('base64'),
                JWT_EXPIRY_S: '900',
                REFRESH_EXPIRY_S: '604800',
                EAN_COUNTER_ID: 'EAN_COUNTER_ID',
                EAN_COUNTER_DIGITS: '9',
                HEALTH_HEAP_THRESHOLD: String(1024 ** 3),
                HEALTH_RSS_THRESHOLD: String(2 * 1024 ** 3),
                HEALTH_DISK_THRESHOLD_PERCENT: '0.99',
                HEALTH_DISK_PATH: root,
                STORE_TIMEZONE: 'Asia/Manila',
            },
            password,
        );
        report = {
            schemaVersion: 1,
            kind: 'windows11-architecture-proof',
            scope: '#357 compiled runtime only; not installed release acceptance',
            sourceCommit: args.commit,
            at: new Date().toISOString(),
            target: os,
            components: {
                node: pins.node.version,
                mongodb: mongoVersion,
                argon2: pins.argon2.version,
            },
            hashes: {
                nodeArchive: pins.node.sha256,
                mongoArchive: pins.mongodb.sha256,
                apiEntry: await sha256(join(api, 'dist/main.js')),
                appModule: await sha256(join(api, 'dist/app.module.js')),
            },
            assertions: {
                authenticatedPrimary: true,
                unauthorizedReadRefused: true,
                transactionCommit: true,
                transactionRollback: true,
                defaultArgon2CorrectAndWrongPassword: true,
                ...apiEvidence,
            },
            observations: {
                hostRamBytes: totalmem(),
                freeRamBytesAtEnd: freemem(),
                cpuCount: cpus().length,
                proofNodeMemory: process.memoryUsage(),
                passwordProofMs,
            },
            limitations: [
                'No Chrome, TLS, services, reboot, installer or full workload exercised.',
                'Process samples are not a minimum-hardware or 4GB qualification.',
                'OS build servicing and CPU model eligibility require release qualification.',
            ],
        };
    } finally {
        await dbClient?.close();
        if (adminClient) {
            try {
                await adminClient
                    .db('admin')
                    .command({ shutdown: 1, force: true });
            } catch {
                /* shutdown closes its own socket */
            }
            await adminClient.close();
        }
        if (mongo) {
            const waitForChild = async () => {
                let timer;
                try {
                    await Promise.race([
                        mongoDone,
                        new Promise((_, reject) => {
                            timer = setTimeout(
                                () => reject(new Error('shutdown timeout')),
                                5000,
                            );
                        }),
                    ]);
                } finally {
                    clearTimeout(timer);
                }
            };
            try {
                await waitForChild();
            } catch {
                mongo.kill();
                await waitForChild(); // Failure prevents any success report.
            }
        }
        await rm(root, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 250,
        });
    }
    await writeFile(output, JSON.stringify(report, null, 2) + '\n', {
        flag: 'wx',
    });
    console.log(
        'Architecture proof passed. Redacted evidence written to the requested new output.',
    );
}

main().catch(() => {
    // Driver/Nest/OS errors may embed credentials or request details. A failed
    // run produces no evidence and never emits raw errors or child logs.
    console.error(
        'Architecture proof failed; no passing evidence was produced. Check the documented prerequisites.',
    );
    process.exitCode = 1;
});
