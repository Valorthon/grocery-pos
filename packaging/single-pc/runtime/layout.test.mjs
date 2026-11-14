import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
    DIRECTORIES,
    ORIGIN,
    PORTS,
    SECRET_FILES,
    SERVICES,
    apiEnv,
    databaseUrl,
    layout,
    mongodConfig,
    runtimeManifest,
    secretPattern,
    quoteArgument,
    serviceDefinitions,
    winswXml,
} from './layout.mjs';
import {
    RefusedError,
    acquireLock,
    parseArgs,
    provision,
    releaseLock,
} from './provision.mjs';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const root = join(tmpdir(), 'gpos-data');
const paths = layout(root);
const secrets = {
    mongoApiPassword: 'a'.repeat(64),
    cookieSecret: 'c'.repeat(64),
    jwtSecret: 'j'.repeat(64),
};

test('layout keeps persistent state in separate directories under one root', () => {
    assert.deepEqual(Object.keys(paths.dirs).sort(), [
        'backups',
        'config',
        'database',
        'logs',
        'secrets',
        'state',
        'tls',
    ]);
    for (const path of Object.values(paths.secrets))
        assert.ok(path.startsWith(paths.dirs.secrets));
    assert.ok(paths.apiEnv.startsWith(paths.dirs.secrets));
    assert.ok(paths.caddyData.startsWith(paths.dirs.tls));
    for (const name of ['secrets', 'database', 'tls', 'state', 'backups'])
        assert.equal(DIRECTORIES[name].private, true);
});

test('mongod is an authenticated single-node replica set on IPv4 loopback only', () => {
    const config = mongodConfig(paths);
    assert.deepEqual(config.net, {
        bindIp: '127.0.0.1',
        port: PORTS.mongo,
        ipv6: false,
    });
    assert.equal(config.security.authorization, 'enabled');
    assert.equal(config.security.keyFile, paths.secrets.mongoKeyfile);
    assert.equal(config.replication.replSetName, 'gpos');
    assert.equal(config.storage.wiredTiger, undefined);
    assert.equal(
        mongodConfig(paths, { cacheSizeGB: 0.5 }).storage.wiredTiger
            .engineConfig.cacheSizeGB,
        0.5,
    );
});

test('API env is single-pc on loopback with the local origin and no domain', () => {
    const env = Object.fromEntries(
        apiEnv(paths, secrets)
            .split('\n')
            .filter((line) => line && !line.startsWith('#'))
            .map((line) => line.split(/=(.*)/s).slice(0, 2)),
    );
    assert.equal(env.APP_ENV, 'single-pc');
    assert.equal(env.HOST, '127.0.0.1');
    assert.equal(env.PORT, String(PORTS.api));
    assert.equal(env.FRONTEND_URL, ORIGIN);
    assert.equal(env.DOMAIN, '');
    assert.notEqual(env.JWT_SECRET, env.COOKIE_SECRET);
    assert.equal(env.HEALTH_DISK_PATH, root);
    assert.match(
        env.DATABASE_URL,
        /^mongodb:\/\/gpos_api:a{64}@127\.0\.0\.1:27018\/grocery\?authSource=admin&directConnection=true$/,
    );
    assert.throws(() =>
        apiEnv(paths, { ...secrets, jwtSecret: 'x\nAPP_ENV=dev' }),
    );
    assert.throws(() => databaseUrl('u', 'p@ss'));
});

test('generated secrets match their stored format, and a damaged one does not', () => {
    for (const spec of Object.values(SECRET_FILES)) {
        const pattern = secretPattern(spec);
        const sample = Buffer.alloc(spec.bytes, 7).toString(spec.encoding);
        assert.match(sample, pattern);
        assert.doesNotMatch(sample.slice(1), pattern);
    }
    // MongoDB accepts keyfiles of 6-1024 base64 characters.
    assert.ok(Math.ceil((SECRET_FILES.mongoKeyfile.bytes * 4) / 3) <= 1024);
});

test('services start DB, API, proxy in dependency order with unbounded backoff restarts', () => {
    const release = join(tmpdir(), 'release', '1.0.0');
    const [mongo, api, proxy] = serviceDefinitions(paths, release);
    assert.deepEqual(
        [mongo.name, api.name, proxy.name],
        [SERVICES.mongo, SERVICES.api, SERVICES.proxy],
    );
    assert.deepEqual(api.dependsOn, [SERVICES.mongo]);
    assert.deepEqual(proxy.dependsOn, [SERVICES.api]);
    assert.equal(api.arguments[0], `--env-file=${paths.apiEnv}`);
    assert.equal(proxy.env.XDG_DATA_HOME, paths.caddyData);
    assert.ok(proxy.env.GPOS_CLIENT_ROOT.startsWith(release));
    // Binaries in the release, state in the data root.
    for (const service of [mongo, api, proxy])
        assert.ok(service.executable.startsWith(release));
    const xml = winswXml(api);
    assert.match(xml, /<depend>GroceryPOS-MongoDB<\/depend>/);
    assert.doesNotMatch(xml, /<onfailure action="none"\/>/);
    assert.match(
        xml,
        /<onfailure action="restart" delay="60 sec"\/>\n  <resetfailure>/,
    );
    assert.match(xml, /<resetfailure>1 hour<\/resetfailure>/);
    assert.match(xml, /<stoptimeout>30 sec<\/stoptimeout>/);
    assert.doesNotMatch(xml, /SECRET|PASSWORD|mongodb:\/\//);
    assert.throws(() => winswXml(mongo));
    const manifest = JSON.stringify(
        runtimeManifest(paths, { installationId: 'id' }),
    );
    assert.doesNotMatch(manifest, /a{64}|c{64}|j{64}/);
});

test('CLI takes no credentials or DB URL and needs absolute paths', () => {
    const args = ['--data-root', root, '--mongod', 'mongod', '--api', 'api'];
    assert.equal(parseArgs(args).dataRoot, root);
    assert.equal(
        parseArgs([...args, '--cache-size-gb', '0.5']).cacheSizeGB,
        0.5,
    );
    for (const invalid of [
        args.slice(2),
        ['--data-root', 'relative', ...args.slice(2)],
        [...args, '--database-url', 'mongodb://x'],
        [...args, '--password', 'x'],
        [...args, '--api', 'other'],
        [...args, '--cache-size-gb', '0.1'],
        [...args, '--store-timezone', 'Not/AZone'],
        [...args, '--cache-size-gb'],
    ])
        assert.throws(() => parseArgs(invalid));
});

test('a foreign or incompatible data root is refused unchanged', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gpos-runtime-test-'));
    try {
        const options = { dataRoot: dir, mongod: 'none', api: 'none' };
        await writeFile(join(dir, 'customer.txt'), 'keep');
        await assert.rejects(provision(options), RefusedError);
        assert.deepEqual(await readdir(dir), ['customer.txt']);

        await rm(join(dir, 'customer.txt'));
        await mkdir(join(dir, 'state'));
        await writeFile(join(dir, 'state', 'install.json'), '{"schema":99}');
        await mkdir(join(dir, 'database'));
        await writeFile(join(dir, 'database', 'WiredTiger'), 'x');
        await assert.rejects(provision(options), /schema 99/);
        await writeFile(join(dir, 'state', 'install.json'), '{not json');
        await assert.rejects(provision(options), RefusedError);
        assert.deepEqual((await readdir(dir)).sort(), ['database', 'state']);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('concurrent runs on an empty root create exactly one installation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gpos-race-'));
    try {
        const logs = [];
        const runs = Array.from({ length: 6 }, () =>
            provision(
                {
                    dataRoot: join(dir, 'root'),
                    mongod: join(dir, 'missing-mongod'),
                    api: join(dir, 'missing-api'),
                },
                (line) => logs.push(line),
            ),
        );
        const results = await Promise.allSettled(runs);
        assert.ok(results.every((r) => r.status === 'rejected'));
        assert.equal(
            logs.filter((line) => line === 'layout: new installation').length,
            1,
        );
        assert.ok(
            results.some(
                (r) =>
                    r.reason instanceof RefusedError &&
                    /Another provisioning run is active/.test(r.reason.message),
            ),
        );
        const install = JSON.parse(
            await readFile(join(dir, 'root', 'state', 'install.json'), 'utf8'),
        );
        assert.match(install.installationId, /^[0-9a-f-]{36}$/);
        const state = await readdir(join(dir, 'root', 'state'));
        assert.ok(!state.some((name) => name.startsWith('provision.lock')));
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('a stale lock is taken over by exactly one of several racing runs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gpos-lock-'));
    try {
        const dead = spawnSync(process.execPath, ['-e', '']).pid;
        const lock = join(dir, 'provision.lock');
        await writeFile(lock, `${dead} stale`);
        const results = await Promise.allSettled(
            Array.from({ length: 8 }, () => acquireLock(lock)),
        );
        const won = results.filter((r) => r.status === 'fulfilled');
        assert.equal(won.length, 1);
        for (const r of results.filter((r) => r.status === 'rejected')) {
            assert.ok(r.reason instanceof RefusedError);
        }
        assert.equal(await readFile(lock, 'utf8'), won[0].value);
        await releaseLock(lock, 'someone else');
        assert.equal(await readFile(lock, 'utf8'), won[0].value);
        await releaseLock(lock, won[0].value);
        assert.deepEqual(await readdir(dir), []);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('Windows argument quoting survives spaces, quotes and trailing backslashes', () => {
    assert.equal(quoteArgument('plain'), 'plain');
    assert.equal(quoteArgument(''), '""');
    assert.equal(
        quoteArgument('C:\\Program Files\\x\\'),
        '"C:\\Program Files\\x\\\\"',
    );
    assert.equal(quoteArgument('a "b"'), '"a \\"b\\""');
    assert.equal(quoteArgument('a\\"b c'), '"a\\\\\\"b c"');
});

test('CI proves the runtime against the MongoDB version the installer ships', async () => {
    const here = new URL('.', import.meta.url);
    const components = JSON.parse(
        await readFile(new URL('../components.json', here), 'utf8'),
    );
    const ci = await readFile(
        new URL('../../../.github/workflows/ci.yml', here),
        'utf8',
    );
    const tags = [...ci.matchAll(/docker create mongo:([\w.]+)\)/g)].map(
        (m) => m[1],
    );
    assert.deepEqual(tags, [components.mongodb.version]);
});
