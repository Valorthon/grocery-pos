// Portable tests for the single-PC bundle builder and installer (#362).
// Windows execution (services, ACLs, Task Scheduler, certutil, shortcuts)
// is not exercised here; the orchestration runs against a recording
// context. See README.md "Verification".
import assert from 'node:assert/strict';
import {
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    stat,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SERVICES, layout } from '../runtime/layout.mjs';
import {
    MANIFEST,
    REQUIRED_RELEASE_FILES,
    RefusedError as BundleRefused,
    acquire,
    buildBundle,
    bundledComponents,
    placeEntry,
    pruneNativeAddons,
    sha256,
    verifyTree,
} from './bundle.mjs';
import {
    EXIT,
    classifyDataRoot,
    parseArgs,
    runInstaller,
    utf16,
} from './install.mjs';
import {
    HANDOVER_FILE,
    HANDOVER_NOTE,
    MIN_FREE,
    TASKS,
    aclSteps,
    backupTaskXml,
    evaluatePreflight,
    locations,
    reminderTaskXml,
    serviceAccount,
    serviceSteps,
    shortcutSpec,
    uninstallSteps,
} from './plan.mjs';
import { readZip, writeZip } from './zip.mjs';

const here = new URL('.', import.meta.url);
const components = JSON.parse(
    await readFile(new URL('../components.json', here), 'utf8'),
);

async function scratch() {
    return mkdtemp(join(tmpdir(), 'gpos-installer-'));
}

// ------------------------------------------------------------ zip

test('the ZIP reader round-trips and refuses unsafe entry paths', () => {
    const entries = readZip(writeZip({ 'a/b.txt': 'hello', 'a/': '' }));
    assert.equal(
        entries
            .find((e) => e.name === 'a/b.txt')
            .data()
            .toString(),
        'hello',
    );
    assert.ok(entries.find((e) => e.name === 'a/').directory);
    for (const bad of ['../evil.exe', '/abs', 'C:/x', 'a/../../b']) {
        assert.throws(() => readZip(writeZip({ [bad]: 'x' })), /Unsafe ZIP/);
    }
    assert.throws(
        () => readZip(Buffer.from('not a zip at all, nope')),
        /Not a ZIP/,
    );
});

// ------------------------------------------------------------ components

test('every bundled component is pinned by https URL, SHA-256 and license', () => {
    const shipped = bundledComponents(components).map((c) => c.key);
    assert.deepEqual(shipped.sort(), [
        'mongodb',
        'mongodbTools',
        'node',
        'proxy',
        'serviceHost',
        'serviceHostLicense',
    ]);
    assert.equal(components.proxy.version, '2.11.9');
    assert.match(components.proxy.url, /caddy_2\.11\.9_windows_amd64\.zip$/);
    assert.match(components.serviceHost.url, /v2\.12\.0\/WinSW\.NET461\.exe$/);
    assert.throws(
        () =>
            bundledComponents({
                x: { url: 'https://a/b', license: 'MIT', bundle: {} },
            }),
        /pinned SHA-256/,
    );
    assert.throws(
        () =>
            bundledComponents({
                x: {
                    url: 'http://a/b',
                    sha256: 'a'.repeat(64),
                    license: 'MIT',
                    bundle: {},
                },
            }),
        /https URL/,
    );
});

test('archive entries map onto the runtime release layout', () => {
    const c = (key) => ({ key, ...components[key] });
    assert.equal(
        placeEntry(c('node'), 'node-v22.23.5-win-x64/node.exe'),
        'node/node.exe',
    );
    assert.equal(
        placeEntry(
            c('mongodb'),
            'mongodb-win32-x86_64-windows-7.0.48/bin/mongod.exe',
        ),
        'mongodb/bin/mongod.exe',
    );
    assert.equal(
        placeEntry(
            c('mongodb'),
            'mongodb-win32-x86_64-windows-7.0.48/bin/mongos.exe',
        ),
        undefined,
    );
    assert.equal(
        placeEntry(
            c('mongodb'),
            'mongodb-win32-x86_64-windows-7.0.48/LICENSE-Community.txt',
        ),
        'notices/mongodb/LICENSE-Community.txt',
    );
    assert.equal(
        placeEntry(
            c('mongodbTools'),
            'mongodb-database-tools-x/bin/mongodump.exe',
        ),
        'mongodb/bin/mongodump.exe',
    );
    assert.equal(placeEntry(c('proxy'), 'caddy.exe'), 'caddy/caddy.exe');
    assert.equal(placeEntry(c('proxy'), 'LICENSE'), 'notices/proxy/LICENSE');
    assert.equal(components.serviceHost.bundle.to, 'services/WinSW.exe');
});

test('downloads are verified; a mismatch or tampered cache is refused', async () => {
    const dir = await scratch();
    const bytes = Buffer.from('payload');
    const component = {
        key: 'x',
        url: 'https://example.invalid/x.zip',
        sha256: sha256(bytes),
    };
    let fetched = 0;
    const fetchImpl = async () => {
        fetched++;
        return { ok: true, arrayBuffer: async () => bytes };
    };
    await assert.rejects(
        acquire(component, { cache: dir, offline: true }),
        /not in the cache/,
    );
    assert.deepEqual(
        await acquire(component, { cache: dir, fetchImpl }),
        bytes,
    );
    assert.deepEqual(
        await acquire(component, { cache: dir, offline: true }),
        bytes,
    );
    assert.equal(fetched, 1);
    const [cached] = await readdir(dir);
    await writeFile(join(dir, cached), 'tampered');
    await assert.rejects(
        acquire(component, { cache: dir, offline: true }),
        BundleRefused,
    );
    await assert.rejects(
        acquire(
            { ...component, sha256: 'b'.repeat(64) },
            { cache: await scratch(), fetchImpl },
        ),
        /mismatch on download/,
    );
    await rm(dir, { recursive: true });
});

test('only Windows x64 native addons ship', async () => {
    const api = await scratch();
    const argon = join(api, 'node_modules', 'argon2', 'prebuilds');
    for (const platform of ['win32-x64', 'linux-x64', 'darwin-arm64']) {
        await mkdir(join(argon, platform), { recursive: true });
        await writeFile(join(argon, platform, 'argon2.node'), platform);
    }
    const removed = await pruneNativeAddons(api);
    assert.equal(removed.length, 2);
    assert.deepEqual(await readdir(argon), ['win32-x64']);
    await mkdir(join(api, 'node_modules', 'other', 'build'), {
        recursive: true,
    });
    await writeFile(join(api, 'node_modules', 'other', 'build', 'x.node'), '');
    await assert.rejects(
        pruneNativeAddons(api),
        /without a Windows x64 prebuild/,
    );
    await rm(api, { recursive: true });
});

// ------------------------------------------------------------ bundle

/** Small fake archives standing in for the pinned components. */
function fakeComponents() {
    const archives = {
        node: writeZip({ 'node-v/node.exe': 'node', 'node-v/LICENSE': 'MIT' }),
        mongodb: writeZip({
            'mongo-v/bin/mongod.exe': 'mongod',
            'mongo-v/bin/mongos.exe': 'mongos',
            'mongo-v/LICENSE-Community.txt': 'SSPL',
        }),
        mongodbTools: writeZip({
            'tools-v/bin/mongodump.exe': 'dump',
            'tools-v/bin/mongorestore.exe': 'restore',
            'tools-v/bin/bsondump.exe': 'bson',
            'tools-v/LICENSE.md': 'Apache',
        }),
        proxy: writeZip({ 'caddy.exe': 'caddy', LICENSE: 'Apache' }),
        serviceHost: Buffer.from('winsw'),
        serviceHostLicense: Buffer.from('MIT'),
    };
    const fake = structuredClone(components);
    for (const [key, bytes] of Object.entries(archives)) {
        fake[key].url = `https://example.invalid/${key}`;
        fake[key].sha256 = sha256(bytes);
    }
    const fetchImpl = async (url) => ({
        ok: true,
        arrayBuffer: async () => archives[url.split('/').pop()],
    });
    return { fake, fetchImpl };
}

async function fakeApp(release) {
    const files = {
        'api/package.json': '{"name":"grocery-pos-api","version":"0.0.1"}',
        'api/dist/main.js': '',
        'api/dist/bootstrap/initial-admin.cli.js': '',
        'client/index.html': '<!doctype html>',
        'client/favicon.ico': '',
    };
    for (const [path, text] of Object.entries(files)) {
        await mkdir(join(release, path, '..'), { recursive: true });
        await writeFile(join(release, path), text);
    }
}

async function makeBundle(dir) {
    const { fake, fetchImpl } = fakeComponents();
    const out = join(dir, 'bundle');
    await buildBundle({
        out,
        cache: join(dir, 'cache'),
        components: fake,
        fetchImpl,
        commit: 'f'.repeat(40),
        version: '0.0.1-test',
        buildApp: fakeApp,
    });
    return out;
}

test('the bundle has the full release layout and a manifest of every file', async () => {
    const dir = await scratch();
    const out = await makeBundle(dir);
    const manifest = JSON.parse(await readFile(join(out, MANIFEST), 'utf8'));
    assert.equal(manifest.version, '0.0.1-test');
    for (const file of REQUIRED_RELEASE_FILES) {
        assert.ok(manifest.files[`release/${file}`], file);
    }
    assert.ok(manifest.files['Install.ps1']);
    assert.equal(manifest.files['release/mongodb/bin/mongos.exe'], undefined);
    assert.ok(manifest.files['release/notices/mongodb/LICENSE-Community.txt']);
    assert.ok(manifest.files['release/notices/serviceHost/LICENSE.txt']);
    assert.ok(
        !Object.keys(manifest.files).some((f) => f.endsWith('.test.mjs')),
        'tests never ship',
    );
    const notice = await readFile(
        join(out, 'release', 'notices', 'COMPONENTS.md'),
        'utf8',
    );
    assert.match(notice, /SSPL-1\.0/);
    assert.match(notice, /github\.com\/mongodb\/mongo\/tree\/r7\.0\.48/);
    const sums = await readFile(join(out, 'SHA256SUMS'), 'utf8');
    assert.match(
        sums,
        new RegExp(
            `${sha256(await readFile(join(out, MANIFEST)))}  ${MANIFEST}`,
        ),
    );
    assert.deepEqual(
        await verifyTree(join(out, 'release'), manifest.files, 'release/'),
        [],
    );

    await writeFile(join(out, 'release', 'caddy', 'caddy.exe'), 'evil');
    await writeFile(join(out, 'release', 'extra.dll'), '');
    await rm(join(out, 'release', 'node', 'LICENSE'));
    assert.deepEqual(
        (
            await verifyTree(join(out, 'release'), manifest.files, 'release/')
        ).sort(),
        [
            'changed caddy/caddy.exe',
            'missing node/LICENSE',
            'unexpected extra.dll',
        ],
    );
    // Never overwrites an existing bundle; a failed build leaves nothing.
    await assert.rejects(makeBundle(dir), /already exists/);
    const { fake, fetchImpl } = fakeComponents();
    fake.proxy.sha256 = 'c'.repeat(64);
    await assert.rejects(
        buildBundle({
            out: join(dir, 'broken'),
            cache: join(dir, 'cache2'),
            components: fake,
            fetchImpl,
            commit: 'f'.repeat(40),
            version: '0.0.1-test',
            buildApp: fakeApp,
        }),
        /mismatch/,
    );
    assert.equal(
        await stat(join(dir, 'broken.partial')).catch(() => null),
        null,
    );
    assert.equal(await stat(join(dir, 'broken')).catch(() => null), null);
    await rm(dir, { recursive: true });
});

// ------------------------------------------------------------ plan

const okFacts = {
    platform: 'win32',
    osBuild: 26100,
    osArchitecture: 'X64',
    serverEdition: false,
    isAdmin: true,
    dotNetRelease: 533320,
    chrome: true,
    servicesInstalled: [],
    portsBusy: [],
    freeBytes: { program: 10 * 1024 ** 3, data: 50 * 1024 ** 3 },
    releaseBytes: 600 * 1024 ** 2,
    dataRoot: 'new',
};

test('preflight refuses unsupported platforms, foreign data, busy ports and low disk', () => {
    assert.deepEqual(evaluatePreflight(okFacts, 'install'), {
        refusals: [],
        warnings: [],
    });
    const refused = (patch, mode = 'install') =>
        evaluatePreflight({ ...okFacts, ...patch }, mode).refusals.join(' ');
    assert.match(refused({ osBuild: 19045 }), /Windows 11/);
    assert.match(refused({ osArchitecture: 'Arm64' }), /x64/);
    assert.match(refused({ serverEdition: true }), /Server/);
    assert.match(refused({ isAdmin: false }), /administrator/);
    assert.match(refused({ dotNetRelease: 0 }), /\.NET Framework/);
    assert.match(
        refused({ dataRoot: 'foreign' }),
        /not a Grocery POS installation/,
    );
    assert.match(refused({ portsBusy: [1443] }), /Port 1443 is in use/);
    assert.match(
        refused({ freeBytes: { program: 1, data: 1 } }),
        /program files/,
    );
    assert.match(
        refused({ freeBytes: { program: 1e12, data: MIN_FREE.dataBytes - 1 } }),
        /data and backups/,
    );
    assert.match(
        refused({ servicesInstalled: [SERVICES.mongo] }),
        /use repair/,
    );
    assert.match(
        refused({}, 'repair'),
        /no Grocery POS installation to repair/,
    );
    // Our own running services may hold their ports during a repair.
    assert.equal(
        refused(
            {
                dataRoot: 'ours',
                servicesInstalled: Object.values(SERVICES),
                portsBusy: [1443, 13000, 27018],
            },
            'repair',
        ),
        '',
    );
    // A reinstall over preserved data is an install, not a refusal.
    assert.equal(refused({ dataRoot: 'ours' }), '');
    assert.match(
        evaluatePreflight({ ...okFacts, chrome: false }, 'install').warnings[0],
        /Chrome/,
    );
});

const loc = locations({
    ProgramFiles: '/pf',
    ProgramData: '/pd',
    PUBLIC: '/users/public',
});

test('the handover folder is restricted and never in a shared location', () => {
    assert.ok(!loc.handoverDir.startsWith('/users/public'));
    assert.ok(!loc.handoverDir.startsWith(loc.dataRoot + '/'));
    assert.ok(loc.releasesDir.startsWith(loc.programDir));
    assert.ok(!loc.dataRoot.startsWith(loc.programDir));
});

test('services register in dependency order under per-service virtual accounts', () => {
    const paths = layout('/pd/data');
    const steps = serviceSteps(paths, '/pf/releases/v1', '/pf/services');
    const execs = steps.filter((s) => s.kind === 'exec');
    assert.ok(execs[0].args.includes('--install'));
    assert.deepEqual(
        execs[0].args.slice(execs[0].args.indexOf('--serviceName'), -2),
        ['--serviceName', SERVICES.mongo],
    );
    const configs = execs.filter((s) => s.args[0] === 'config');
    assert.deepEqual(
        configs.map((s) => [s.args[1], s.args[3], s.args[7]]),
        [
            [SERVICES.mongo, serviceAccount(SERVICES.mongo), '/'],
            [SERVICES.api, serviceAccount(SERVICES.api), SERVICES.mongo],
            [SERVICES.proxy, serviceAccount(SERVICES.proxy), SERVICES.api],
        ],
    );
    for (const name of Object.values(SERVICES)) {
        const failure = execs.find(
            (s) => s.args[0] === 'failure' && s.args[1] === name,
        );
        assert.deepEqual(failure.args.slice(2), [
            'reset=',
            '3600',
            'actions=',
            'restart/10000/restart/30000/restart/60000',
        ]);
    }
    // WinSW wrappers live outside the verified release folder.
    const writes = steps.filter((s) => s.kind === 'write');
    assert.deepEqual(
        writes.map((s) => s.path),
        [
            `/pf/services/${SERVICES.api}.xml`,
            `/pf/services/${SERVICES.proxy}.xml`,
        ],
    );
    assert.match(
        writes[0].text,
        /<executable>\/pf\/releases\/v1\/node\/node\.exe</,
    );
});

test('ACL grants follow the runtime README permissions table', () => {
    const paths = layout('/pd/data');
    const grants = aclSteps(paths, '/r').map((s) => s.args);
    const by = (svc) =>
        grants
            .filter((a) => a[2].startsWith(`${serviceAccount(svc)}:`))
            .map((a) => [a[0], a[2].split(':')[1]]);
    assert.deepEqual(by(SERVICES.mongo), [
        [paths.dirs.database, '(OI)(CI)M'],
        [paths.dirs.logs, '(OI)(CI)M'],
        [paths.dirs.config, '(OI)(CI)RX'],
        [paths.secrets.mongoKeyfile, '(R)'],
    ]);
    assert.deepEqual(by(SERVICES.api), [
        [paths.apiEnv, '(R)'],
        [paths.apiLogs, '(OI)(CI)M'],
    ]);
    assert.deepEqual(by(SERVICES.proxy), [
        [paths.dirs.tls, '(OI)(CI)M'],
        [paths.proxyLogs, '(OI)(CI)M'],
        ['/r/client', '(OI)(CI)RX'],
    ]);
    // Nobody but SYSTEM/Administrators gets the root, secrets or backups.
    for (const path of [paths.root, paths.dirs.secrets, paths.dirs.backups]) {
        assert.ok(!grants.some((a) => a[0] === path));
    }
});

test('the daily backup task uses the #363 interface as SYSTEM; the reminder runs unelevated', () => {
    const paths = layout('/pd/data');
    const backup = backupTaskXml(paths, '/r', '21:30');
    assert.match(backup, /<UserId>S-1-5-18<\/UserId>/);
    assert.match(backup, /T21:30:00<\/StartBoundary>/);
    assert.match(backup, /<DaysInterval>1<\/DaysInterval>/);
    assert.match(backup, /<StartWhenAvailable>true<\/StartWhenAvailable>/);
    assert.match(backup, /<Command>\/r\/node\/node\.exe<\/Command>/);
    assert.match(
        backup,
        /backup\.mjs create --data-root \/pd\/data --mongod \/r\/mongodb\/bin\/mongod\.exe --tools \/r\/mongodb\/bin --api \/r\/api --kind scheduled/,
    );
    assert.throws(() => backupTaskXml(paths, '/r', '25:00'), /HH:MM/);
    const reminder = reminderTaskXml('/r');
    assert.match(reminder, /<GroupId>S-1-5-32-545<\/GroupId>/);
    assert.match(reminder, /<RunLevel>LeastPrivilege<\/RunLevel>/);
    assert.match(reminder, /<Monday \/>/);
    assert.match(reminder, /ExportReminder\.ps1/);
    for (const xml of [backup, reminder]) {
        assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-16"?>'));
        assert.equal((xml.match(/<(\w+)[\s>]/g) ?? []).length > 0, true);
        const opened = [...xml.matchAll(/<(\w+)(?:\s[^>]*)?>/g)].filter(
            (m) => !m[0].endsWith('/>'),
        ).length;
        const closed = [...xml.matchAll(/<\/(\w+)>/g)].length;
        assert.equal(opened, closed, 'balanced elements');
    }
    assert.deepEqual(utf16('a').subarray(0, 2), Buffer.from([0xff, 0xfe]));
});

test('the shortcut waits for readiness through Launch.ps1', () => {
    const spec = shortcutSpec('/r');
    assert.equal(spec.target, 'powershell.exe');
    assert.match(spec.arguments, /-WindowStyle Hidden/);
    assert.match(
        spec.arguments,
        /Launch\.ps1 -Origin https:\/\/localhost:1443$/,
    );
});

test('uninstall touches services, tasks and shortcuts only', () => {
    const steps = uninstallSteps({
        installedServices: Object.values(SERVICES),
        shortcuts: loc.shortcuts,
    });
    assert.deepEqual(
        steps.filter((s) => s.kind === 'stop').map((s) => s.name),
        [SERVICES.proxy, SERVICES.api, SERVICES.mongo],
    );
    assert.deepEqual(
        steps.filter((s) => s.kind === 'remove').map((s) => s.path),
        loc.shortcuts,
    );
    for (const step of steps) {
        assert.ok(!JSON.stringify(step).includes(loc.dataRoot));
    }
});

// ------------------------------------------------------------ orchestration

function recordingContext(dir, { failProvisionOnce = false } = {}) {
    const where = locations({
        ProgramFiles: join(dir, 'pf'),
        ProgramData: join(dir, 'pd'),
        PUBLIC: join(dir, 'public'),
    });
    const log = [];
    const services = new Map(); // name -> 'RUNNING' | 'STOPPED'
    let failProvision = failProvisionOnce;
    let adminCreated = false;
    const ctx = {
        windows: true,
        locations: where,
        log,
        services,
        async facts() {
            return { ...okFacts, servicesInstalled: [...services.keys()] };
        },
        async exec(file, args) {
            log.push([file, ...args]);
            if (args.includes('--install'))
                services.set(SERVICES.mongo, 'STOPPED');
            if (args[0] === 'install') {
                services.set(
                    file.split('/').pop().replace('.exe', ''),
                    'STOPPED',
                );
            }
            if (file === 'sc.exe' && args[0] === 'delete')
                services.delete(args[1]);
            if (args.some((a) => String(a).endsWith('initial-admin.cli.js'))) {
                if (adminCreated) return { code: 3 };
                const target = args[args.length - 1];
                if (args.includes('--generate-password-file')) {
                    await writeFile(target, 'temporary', { flag: 'wx' });
                }
                adminCreated = true;
            }
            return { code: 0 };
        },
        async provision(options) {
            log.push(['provision', options.dataRoot]);
            if (failProvision) {
                failProvision = false;
                throw new Error('power cut');
            }
            const paths = layout(options.dataRoot);
            for (const d of Object.values(paths.dirs))
                await mkdir(d, { recursive: true });
            await writeFile(paths.install, '{}');
            await writeFile(paths.apiEnv, 'APP_ENV=single-pc\n');
        },
        async startService(name) {
            log.push(['start', name]);
            services.set(name, 'RUNNING');
        },
        async stopService(name) {
            if (services.get(name) === 'RUNNING') log.push(['stop', name]);
            if (services.has(name)) services.set(name, 'STOPPED');
        },
        async waitReady(name) {
            log.push(['ready', name]);
        },
        async waitFile() {},
        async createShortcuts(targets) {
            for (const path of targets) {
                await mkdir(join(path, '..'), { recursive: true });
                await writeFile(path, 'lnk');
            }
        },
    };
    return ctx;
}

test('install, repair, uninstall and reinstall keep data, secrets and the release separate', async () => {
    const dir = await scratch();
    const bundle = await makeBundle(dir);
    const ctx = recordingContext(dir, { failProvisionOnce: true });
    const where = ctx.locations;

    await assert.rejects(
        runInstaller({ mode: 'install', bundle }, ctx),
        /--admin-username is required/,
    );
    // Interrupted install (power cut during provisioning): nothing removed,
    // the release stays verified in place, the re-run resumes.
    await assert.rejects(
        runInstaller({ mode: 'install', bundle, adminUsername: 'owner' }, ctx),
        /power cut/,
    );
    assert.ok(await stat(join(where.releasesDir, '0.0.1-test')));
    const result = await runInstaller(
        { mode: 'install', bundle, adminUsername: 'owner' },
        ctx,
    );
    assert.equal(result.handover, where.handoverDir);
    const order = ctx.log.filter((e) => e[0] === 'start' || e[0] === 'ready');
    assert.deepEqual(order, [
        ['start', SERVICES.mongo],
        ['ready', SERVICES.mongo],
        ['start', SERVICES.api],
        ['ready', SERVICES.api],
        ['start', SERVICES.proxy],
        ['ready', SERVICES.proxy],
        ['ready', SERVICES.proxy],
    ]);
    const flat = ctx.log.map((e) => e.join(' '));
    const at = (pattern) => flat.findIndex((line) => pattern.test(line));
    assert.ok(
        at(/^icacls\.exe .*NT SERVICE/) > at(/ install$/),
        'ACLs after registration',
    );
    assert.ok(
        at(/^icacls\.exe .*NT SERVICE/) < at(/^start /),
        'ACLs before start',
    );
    assert.ok(
        at(/^certutil\.exe -addstore -f Root .*root\.crt$/) > at(/^start /),
    );
    assert.ok(at(/--generate-password-file/) > at(/^certutil/));
    assert.match(flat[at(/initial-admin/)], /--username owner/);
    assert.match(flat[at(/initial-admin/)], /--env-file=/);
    for (const name of Object.values(TASKS)) {
        assert.ok(
            flat.some((l) =>
                l.startsWith(`schtasks.exe /Create /TN ${name} /XML`),
            ),
        );
    }
    assert.deepEqual(
        (await readdir(where.handoverDir)).sort(),
        [HANDOVER_NOTE, HANDOVER_FILE].sort(),
    );
    assert.match(
        await readFile(join(where.handoverDir, HANDOVER_NOTE), 'utf8'),
        /Username: owner/,
    );
    const state = JSON.parse(
        await readFile(join(where.dataRoot, 'state', 'installer.json'), 'utf8'),
    );
    assert.equal(state.complete, true);
    assert.equal(state.adminUsername, 'owner');
    for (const path of where.shortcuts) assert.ok(await stat(path));
    assert.equal(await classifyDataRoot(where.dataRoot), 'ours');

    // Install again is refused (services exist); repair stops in reverse
    // order, keeps the verified release, re-registers and keeps the admin.
    await assert.rejects(
        runInstaller({ mode: 'install', bundle, adminUsername: 'owner' }, ctx),
        /use repair/,
    );
    ctx.log.length = 0;
    await runInstaller({ mode: 'repair', bundle }, ctx);
    assert.deepEqual(
        ctx.log.filter((e) => e[0] === 'stop').map((e) => e[1]),
        [SERVICES.proxy, SERVICES.api, SERVICES.mongo],
    );
    assert.ok(ctx.log.some((e) => e[0] === 'sc.exe' && e[1] === 'delete'));
    assert.ok(
        ctx.log.some((e) => e.includes('--password-file')),
        'reuses the handover file',
    );

    // A damaged release is moved aside and replaced on repair.
    const release = join(where.releasesDir, '0.0.1-test');
    await writeFile(join(release, 'caddy', 'caddy.exe'), 'damaged');
    await runInstaller({ mode: 'repair', bundle }, ctx);
    assert.equal(
        await readFile(join(release, 'caddy', 'caddy.exe'), 'utf8'),
        'caddy',
    );
    assert.ok(
        (await readdir(where.releasesDir)).some((n) => n.includes('.damaged-')),
    );

    // Uninstall: services, tasks, shortcuts and binaries go; data stays.
    const secretsBefore = await readFile(layout(where.dataRoot).apiEnv, 'utf8');
    ctx.log.length = 0;
    const removed = await runInstaller({ mode: 'uninstall' }, ctx);
    assert.deepEqual(removed.kept, [where.dataRoot, where.handoverDir]);
    assert.equal(ctx.services.size, 0);
    assert.equal(await stat(where.releasesDir).catch(() => null), null);
    for (const path of where.shortcuts) {
        assert.equal(await stat(path).catch(() => null), null);
    }
    assert.ok(
        !ctx.log.some((e) => e[0] === 'certutil.exe'),
        'CA trust kept by default',
    );
    assert.equal(
        await readFile(layout(where.dataRoot).apiEnv, 'utf8'),
        secretsBefore,
    );

    // Reinstall over the preserved data: no username needed, admin kept.
    ctx.log.length = 0;
    await runInstaller({ mode: 'install', bundle }, ctx);
    assert.ok(ctx.log.some((e) => e[0] === 'provision'));
    assert.equal(
        await readFile(layout(where.dataRoot).apiEnv, 'utf8'),
        secretsBefore,
    );

    // Handover cleanup refuses unknown files, then deletes only its own.
    await writeFile(join(where.handoverDir, 'other.txt'), '');
    await assert.rejects(
        runInstaller({ mode: 'handover-done' }, ctx),
        /other files/,
    );
    await rm(join(where.handoverDir, 'other.txt'));
    assert.deepEqual(await runInstaller({ mode: 'handover-done' }, ctx), {
        mode: 'handover-done',
        deleted: true,
    });
    await rm(dir, { recursive: true });
});

test('a modified bundle and a foreign data folder are refused before any change', async () => {
    const dir = await scratch();
    const bundle = await makeBundle(dir);
    const ctx = recordingContext(dir);
    await writeFile(
        join(bundle, 'release', 'api', 'dist', 'main.js'),
        'tampered',
    );
    await assert.rejects(
        runInstaller({ mode: 'install', bundle, adminUsername: 'owner' }, ctx),
        /damaged or modified/,
    );
    const clean = await makeBundle(await scratch());
    await mkdir(ctx.locations.dataRoot, { recursive: true });
    await writeFile(join(ctx.locations.dataRoot, 'someone-elses.txt'), '');
    await assert.rejects(
        runInstaller(
            { mode: 'install', bundle: clean, adminUsername: 'owner' },
            ctx,
        ),
        /not a Grocery POS installation/,
    );
    assert.deepEqual(ctx.log, []);
    assert.equal(await stat(ctx.locations.releasesDir).catch(() => null), null);
    await rm(dir, { recursive: true });
});

test('installer arguments are validated per mode', () => {
    assert.throws(() => parseArgs([]), /first argument/);
    assert.throws(() => parseArgs(['install']), /--bundle is required/);
    assert.throws(
        () => parseArgs(['uninstall', '--bundle', 'x']),
        /Unknown option/,
    );
    assert.throws(
        () => parseArgs(['repair', '--bundle', 'x', '--backup-time', '7pm']),
        /HH:MM/,
    );
    assert.deepEqual(parseArgs(['uninstall', '--remove-ca-trust']), {
        mode: 'uninstall',
        removeCaTrust: true,
    });
    assert.deepEqual(
        parseArgs([
            'install',
            '--bundle',
            'b',
            '--admin-username',
            'owner',
            '--backup-time',
            '21:00',
        ]),
        {
            mode: 'install',
            bundle: 'b',
            adminUsername: 'owner',
            backupTime: '21:00',
        },
    );
    assert.equal(EXIT.REFUSED, 3);
});

// ------------------------------------------------------------ PowerShell

test('the PowerShell scripts are strict, offline and never run downloaded code', async () => {
    for (const name of ['Install.ps1', 'Launch.ps1', 'ExportReminder.ps1']) {
        const text = await readFile(new URL(name, here), 'utf8');
        assert.match(text, /^#Requires -Version 5\.1/, name);
        assert.match(text, /Set-StrictMode -Version Latest/, name);
        assert.match(text, /\$ErrorActionPreference = 'Stop'/, name);
        assert.doesNotMatch(
            text,
            /Invoke-Expression|\biex\b|DownloadString|DownloadFile|Start-BitsTransfer|Invoke-RestMethod/i,
            name,
        );
        // The only URL is the local origin.
        for (const url of text.match(/https?:\/\/[^\s'"`)]+/g) ?? []) {
            assert.match(url, /^https:\/\/localhost:1443/, `${name}: ${url}`);
        }
        // Balanced braces and parentheses (no PowerShell parser on Linux).
        const code = text
            .replace(/'[^'\n]*'/g, "''")
            .replace(/"[^"\n]*"/g, '""')
            .replace(/<#[\s\S]*?#>/g, '');
        for (const [open, close] of [
            ['{', '}'],
            ['(', ')'],
        ]) {
            assert.equal(
                code.split(open).length,
                code.split(close).length,
                `${name} ${open}${close}`,
            );
        }
    }
    const install = await readFile(new URL('Install.ps1', here), 'utf8');
    assert.match(
        install,
        /IsInRole\(\[Security\.Principal\.WindowsBuiltInRole\]::Administrator\)/,
    );
    assert.match(install, /Get-FileHash -Algorithm SHA256/);
    const launch = await readFile(new URL('Launch.ps1', here), 'utf8');
    assert.match(launch, /\/v1\/health\/ready/);
    assert.match(launch, /Tls12/);
});
