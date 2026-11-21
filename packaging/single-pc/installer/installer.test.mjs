// Portable tests for the single-PC bundle builder and installer (#362).
// Windows execution (services, ACLs, Task Scheduler, certutil, shortcuts)
// is not exercised here; the orchestration runs against a recording
// context. See README.md "Verification".
import { execFile, execFileSync } from 'node:child_process';
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
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { LAN_SERVICE, SERVICES, layout } from '../runtime/layout.mjs';
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
    createRunLog,
    readinessFailure,
    proxyReady,
    systemTrustProbeArgs,
    serviceErrorLog,
    parseArgs,
    parseLanAddress,
    runInstaller,
    utf16,
} from './install.mjs';
import {
    HANDOVER_FILE,
    HANDOVER_NOTE,
    MIN_FREE,
    installerLogName,
    resumeCommand,
    resumeMode,
    TASKS,
    aclSteps,
    backupShortcutSpec,
    addMinutes,
    allShortcuts,
    checkShortcutSpec,
    terminalPackageShortcutSpec,
    helpShortcutSpec,
    ownerGuideShortcutSpec,
    logRotationTaskXml,
    releasesToPrune,
    backupTaskXml,
    evaluatePreflight,
    FIREWALL_RULE,
    firewallSteps,
    timeServerSteps,
    NTP_FIREWALL_RULE,
    locations,
    reminderTaskXml,
    serviceAccount,
    serviceSteps,
    shortcutSpec,
    uninstallSteps,
} from './plan.mjs';
import { readZip, writeZip } from './zip.mjs';
import { acceptableDrives, parseLetters } from './usb-drives.mjs';
import { classifyWindows } from '../backup/removable.mjs';
import { BackupError, report } from '../backup/backup.mjs';

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

/** What Install.ps1 hands install.mjs: its own verified manifest copy in a
 *  separate (admin-only) folder and the vendor-recorded hash. */
async function pin(bundle) {
    const run = await scratch();
    const bytes = await readFile(join(bundle, MANIFEST));
    await writeFile(join(run, MANIFEST), bytes);
    return {
        bundle,
        manifest: join(run, MANIFEST),
        manifestSha256: sha256(bytes),
    };
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
    // A foreign listener is refused even while our service is installed.
    assert.match(
        refused(
            {
                dataRoot: 'ours',
                servicesInstalled: Object.values(SERVICES),
                portsBusy: [1443],
                portsForeign: [1443],
            },
            'repair',
        ),
        /Port 1443 is in use/,
    );
});

test('repair keeps the current release and the newest other one', () => {
    assert.deepEqual(
        releasesToPrune(
            [
                { name: 'v1', mtimeMs: 1 },
                { name: 'v2', mtimeMs: 2 },
                { name: 'v3', mtimeMs: 3 },
                { name: 'v4', mtimeMs: 4 },
                { name: 'v3.damaged-9', mtimeMs: 9 },
                { name: 'v4.partial', mtimeMs: 10 },
            ],
            'v3',
        ).sort(),
        ['v1', 'v2', 'v3.damaged-9', 'v4.partial'],
    );
});

test('the backup shortcut runs the guided USB export with the installation paths', () => {
    const paths = layout('/pd/data');
    const spec = backupShortcutSpec(paths, '/r');
    assert.equal(spec.target, 'powershell.exe');
    assert.match(
        spec.arguments,
        /BackupToUsb\.ps1 -DataRoot \/pd\/data -Release \/r$/,
    );
    assert.ok(
        loc.backupShortcuts.every((p) =>
            p.endsWith('Back up to USB drive.lnk'),
        ),
    );
    assert.deepEqual(
        loc.backupShortcuts.map((p) => p.split('/').slice(0, -1).join('/')),
        loc.shortcuts.map((p) => p.split('/').slice(0, -1).join('/')),
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
        lanFacts: { lanIpPresent: true },
        blockers: { openShifts: 0, activeLeases: 0 },
        async facts({ lanIp } = {}) {
            ctx.factsLanIp = lanIp ?? null;
            return {
                ...okFacts,
                ...ctx.lanFacts,
                servicesInstalled: [...services.keys()],
            };
        },
        async lanChangeBlockers(paths, release) {
            log.push(['lanChangeBlockers', release]);
            // A list answers one call each (a shift opening in between).
            return Array.isArray(ctx.blockers)
                ? ctx.blockers.shift()
                : ctx.blockers;
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
            log.push(['provision-lan', options.lanIp]);
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
        async waitServiceGone(name) {
            log.push(['gone', name]);
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
    const pinned = await pin(bundle);
    const ctx = recordingContext(dir, { failProvisionOnce: true });
    const where = ctx.locations;

    await assert.rejects(
        runInstaller({ mode: 'install', ...pinned }, ctx),
        /--admin-username is required/,
    );
    // Interrupted install (power cut during provisioning): nothing removed,
    // the release stays verified in place, the re-run resumes.
    await assert.rejects(
        runInstaller(
            { mode: 'install', ...pinned, adminUsername: 'owner' },
            ctx,
        ),
        /power cut/,
    );
    assert.ok(await stat(join(where.releasesDir, '0.0.1-test')));
    const result = await runInstaller(
        { mode: 'install', ...pinned, adminUsername: 'owner' },
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
    for (const path of allShortcuts(where)) assert.ok(await stat(path));
    assert.equal(await classifyDataRoot(where.dataRoot), 'ours');

    // Install again is refused (services exist); repair stops in reverse
    // order, keeps the verified release, re-registers and keeps the admin.
    await assert.rejects(
        runInstaller(
            { mode: 'install', ...pinned, adminUsername: 'owner' },
            ctx,
        ),
        /use repair/,
    );
    ctx.log.length = 0;
    await runInstaller({ mode: 'repair', ...pinned }, ctx);
    assert.deepEqual(
        ctx.log.filter((e) => e[0] === 'stop').map((e) => e[1]),
        [SERVICES.proxy, SERVICES.api, SERVICES.mongo],
    );
    // Each deleted service is gone before it is registered again (1072).
    const flatRepair = ctx.log.map((e) => e.join(' '));
    for (const name of Object.values(SERVICES)) {
        const deleted = flatRepair.indexOf(`sc.exe delete ${name}`);
        const gone = flatRepair.indexOf(`gone ${name}`);
        assert.ok(deleted >= 0 && gone > deleted, name);
        const registered = flatRepair.findIndex(
            (l) =>
                l.includes(`--serviceName ${name}`) ||
                l.endsWith(`${name}.exe install`),
        );
        assert.ok(registered > gone, `${name} registered after it is gone`);
    }
    assert.ok(
        ctx.log.some((e) => e.includes('--password-file')),
        'reuses the handover file',
    );

    // A damaged release is moved aside and replaced on repair.
    const release = join(where.releasesDir, '0.0.1-test');
    await writeFile(join(release, 'caddy', 'caddy.exe'), 'damaged');
    await runInstaller({ mode: 'repair', ...pinned }, ctx);
    assert.equal(
        await readFile(join(release, 'caddy', 'caddy.exe'), 'utf8'),
        'caddy',
    );
    // The damaged copy was moved aside, then pruned once repair succeeded.
    assert.deepEqual(await readdir(where.releasesDir), ['0.0.1-test']);

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
    await runInstaller({ mode: 'install', ...pinned }, ctx);
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
    const pinned = await pin(bundle);
    const ctx = recordingContext(dir);
    await writeFile(
        join(bundle, 'release', 'api', 'dist', 'main.js'),
        'tampered',
    );
    await assert.rejects(
        runInstaller(
            { mode: 'install', ...pinned, adminUsername: 'owner' },
            ctx,
        ),
        /damaged or modified/,
    );
    const clean = await makeBundle(await scratch());
    await mkdir(ctx.locations.dataRoot, { recursive: true });
    await writeFile(join(ctx.locations.dataRoot, 'someone-elses.txt'), '');
    await assert.rejects(
        runInstaller(
            { mode: 'install', ...(await pin(clean)), adminUsername: 'owner' },
            ctx,
        ),
        /not a Grocery POS installation/,
    );
    assert.deepEqual(ctx.log, []);
    assert.equal(await stat(ctx.locations.releasesDir).catch(() => null), null);
    await rm(dir, { recursive: true });
});

test('a manifest or release file swapped after Install.ps1 checked it is refused', async () => {
    const dir = await scratch();
    const bundle = await makeBundle(dir);
    const pinned = await pin(bundle);
    const install = (ctx, extra = {}) =>
        runInstaller(
            { mode: 'install', ...pinned, adminUsername: 'owner', ...extra },
            ctx,
        );

    // The bundle's own manifest is rewritten to match a swapped file: the
    // installer only trusts its verified copy, so the swap is caught.
    const evil = join(bundle, 'release', 'caddy', 'caddy.exe');
    await writeFile(evil, 'evil');
    const manifest = JSON.parse(await readFile(join(bundle, MANIFEST), 'utf8'));
    manifest.files['release/caddy/caddy.exe'] = sha256(Buffer.from('evil'));
    await writeFile(join(bundle, MANIFEST), JSON.stringify(manifest));
    const ctx = recordingContext(dir);
    await assert.rejects(install(ctx), /damaged or modified/);

    // A verified copy that no longer matches the recorded hash is refused.
    await writeFile(pinned.manifest, JSON.stringify(manifest));
    await assert.rejects(install(ctx), /does not match the SHA-256/);

    // A file swapped after verification, while the release is being placed,
    // is caught at the destination; nothing is installed.
    const clean = await makeBundle(await scratch());
    const cleanPin = await pin(clean);
    const racing = recordingContext(await scratch());
    const facts = racing.facts;
    racing.facts = async (...args) => {
        await writeFile(join(clean, 'release', 'caddy', 'caddy.exe'), 'evil');
        return facts(...args);
    };
    await assert.rejects(
        runInstaller(
            { mode: 'install', ...cleanPin, adminUsername: 'owner' },
            racing,
        ),
        /changed while it was copied/,
    );
    assert.deepEqual(await readdir(racing.locations.releasesDir), []);
    assert.ok(!racing.log.some((e) => e[0] === 'provision'));
    await rm(dir, { recursive: true });
});

test('LAN terminals: preflight, firewall rule and uninstall (#396)', () => {
    const lan = { ...okFacts, lanIp: '192.168.1.10' };
    assert.deepEqual(
        evaluatePreflight({ ...lan, lanIpPresent: true }, 'install'),
        { refusals: [], warnings: [] },
    );
    assert.match(
        evaluatePreflight(
            { ...lan, lanIpPresent: false, lanIpChanged: true },
            'install',
        ).refusals[0],
        /192\.168\.1\.10 is not an address of this PC/,
    );
    // A kept IP that is briefly absent only warns (repair, upgrade, rollback).
    const kept = evaluatePreflight(
        { ...lan, dataRoot: 'ours', lanIpPresent: false },
        'repair',
    );
    assert.deepEqual(kept.refusals, []);
    assert.match(kept.warnings[0], /not an address of this PC right now/);
    assert.match(
        evaluatePreflight(
            {
                ...lan,
                dataRoot: 'ours',
                lanIpPresent: true,
                lanIpMultiple: true,
            },
            'repair',
        ).warnings[0],
        /more than one network adapter/,
    );
    // Preferred addresses only; Public on any adapter wins.
    assert.deepEqual(parseLanAddress(''), {
        lanIpPresent: false,
        lanIpMultiple: false,
        lanProfile: undefined,
    });
    assert.deepEqual(parseLanAddress('present|Private\r\n'), {
        lanIpPresent: true,
        lanIpMultiple: false,
        lanProfile: 'Private',
    });
    assert.deepEqual(parseLanAddress('present|Private\npresent|Public\n'), {
        lanIpPresent: true,
        lanIpMultiple: true,
        lanProfile: 'Public',
    });
    assert.match(
        evaluatePreflight(
            { ...lan, lanIpPresent: true, lanPortForeign: true },
            'repair',
        ).refusals.join(' '),
        /Port 1443 on 192\.168\.1\.10 is in use/,
    );
    assert.match(
        evaluatePreflight(
            { ...lan, lanIpPresent: true, lanProfile: 'Public' },
            'install',
        ).warnings[0],
        /Public profile/,
    );

    const steps = firewallSteps('/r', '192.168.1.10');
    assert.deepEqual(steps[0].args, [
        'advfirewall',
        'firewall',
        'delete',
        'rule',
        `name=${FIREWALL_RULE}`,
    ]);
    assert.equal(steps[0].allowFailure, true);
    const add = steps[1].args;
    for (const arg of [
        'dir=in',
        'action=allow',
        'protocol=TCP',
        'localport=1443',
        'localip=192.168.1.10',
        'remoteip=localsubnet',
        'profile=private',
        `program=${join('/r', 'caddy', 'caddy.exe')}`,
    ])
        assert.ok(add.includes(arg), arg);
    assert.ok(!add.some((a) => /any|0\.0\.0\.0|public|domain/i.test(a)));
    assert.ok(!add.some((a) => a.startsWith('service=')));
    // No LAN IP: the rule is only deleted.
    assert.deepEqual(firewallSteps('/r', null), [steps[0]]);

    const removal = uninstallSteps({
        installedServices: [],
        shortcuts: [],
    }).find((s) => s.file === 'netsh.exe');
    assert.deepEqual(removal, steps[0]);
});

test('the LAN IP is stored, kept by repair and changed only without open shifts or leases (#396)', async () => {
    const dir = await scratch();
    const bundle = await makeBundle(dir);
    const pinned = await pin(bundle);
    const ctx = recordingContext(dir);
    const paths = layout(ctx.locations.dataRoot);
    const state = async () =>
        JSON.parse(await readFile(join(paths.dirs.state, 'installer.json')));
    const netsh = () =>
        ctx.log.filter((e) => e[0] === 'netsh.exe').map((e) => e.join(' '));

    const result = await runInstaller(
        {
            mode: 'install',
            ...pinned,
            adminUsername: 'owner',
            lanIp: '192.168.1.10',
        },
        ctx,
    );
    assert.equal(result.lanOrigin, 'https://192.168.1.10:1443');
    // The LAN proxy is its own service, registered and started last.
    assert.ok(ctx.services.has(LAN_SERVICE));
    assert.ok(
        existsSync(
            join(ctx.locations.programDir, 'services', `${LAN_SERVICE}.xml`),
        ),
    );
    const started = ctx.log.filter((e) => e[0] === 'start').map((e) => e[1]);
    assert.deepEqual(started.slice(-2), [SERVICES.proxy, LAN_SERVICE]);
    assert.ok(
        ctx.log.some(
            (e) =>
                e[0] === 'icacls.exe' &&
                e[3] === `NT SERVICE\\${LAN_SERVICE}:(OI)(CI)M`,
        ),
    );
    assert.equal((await state()).lanIp, '192.168.1.10');
    assert.ok(
        ctx.log.some(
            (e) => e[0] === 'provision-lan' && e[1] === '192.168.1.10',
        ),
    );
    assert.ok(netsh().some((l) => l.includes('localip=192.168.1.10')));
    assert.ok(
        netsh().some(
            (l) =>
                l.includes(`name=${NTP_FIREWALL_RULE}`) &&
                l.includes('localip=192.168.1.10'),
        ),
    );
    assert.ok(
        ctx.log.some(
            (e) => e[0] === 'w32tm.exe' && e.includes('/reliable:yes'),
        ),
    );

    // Repair without --lan-ip keeps it and checks nothing.
    ctx.log.length = 0;
    await runInstaller({ mode: 'repair', ...pinned }, ctx);
    assert.equal(ctx.factsLanIp, '192.168.1.10');
    assert.ok(
        ctx.log.some(
            (e) => e[0] === 'provision-lan' && e[1] === '192.168.1.10',
        ),
    );
    assert.ok(!ctx.log.some((e) => e[0] === 'lanChangeBlockers'));

    // A new IP is refused, before anything stops, while a shift is open or
    // a terminal holds a lease.
    for (const blockers of [
        { openShifts: 1, activeLeases: 0 },
        { openShifts: 0, activeLeases: 2 },
    ]) {
        ctx.blockers = blockers;
        ctx.log.length = 0;
        await assert.rejects(
            runInstaller(
                { mode: 'repair', ...pinned, lanIp: '192.168.1.20' },
                ctx,
            ),
            /The LAN IP cannot change now/,
        );
        assert.ok(
            !ctx.log.some((e) => e[0] === 'stop' || e[0] === 'provision'),
        );
        assert.equal((await state()).lanIp, '192.168.1.10');
    }
    // A shift opened while the proxy and API stop is caught by the second
    // check; the services are started again and nothing changes.
    ctx.blockers = [
        { openShifts: 0, activeLeases: 0 },
        { openShifts: 1, activeLeases: 0 },
    ];
    ctx.log.length = 0;
    await assert.rejects(
        runInstaller({ mode: 'repair', ...pinned, lanIp: '192.168.1.20' }, ctx),
        /The LAN IP cannot change now: 1 shift/,
    );
    assert.deepEqual(
        ctx.log.filter((e) => ['stop', 'start', 'provision'].includes(e[0])),
        [
            ['stop', LAN_SERVICE],
            ['stop', SERVICES.proxy],
            ['stop', SERVICES.api],
            ['start', SERVICES.api],
            ['start', SERVICES.proxy],
            ['start', LAN_SERVICE],
        ],
    );
    assert.equal((await state()).lanIp, '192.168.1.10');
    // A new IP that is missing is refused by preflight.
    ctx.lanFacts = { lanIpPresent: false };
    await assert.rejects(
        runInstaller({ mode: 'repair', ...pinned, lanIp: '192.168.1.20' }, ctx),
        /not an address of this PC\. /,
    );
    // The kept IP missing (router off) does not block a repair; the LAN
    // service is still registered and started, without waiting for it.
    ctx.log.length = 0;
    const kept = await runInstaller({ mode: 'repair', ...pinned }, ctx);
    assert.ok(
        kept.warnings.some((w) =>
            w.includes(`${LAN_SERVICE} is not answering`),
        ),
    );
    assert.ok(ctx.log.some((e) => e[0] === 'start' && e[1] === LAN_SERVICE));
    assert.ok(!ctx.log.some((e) => e[0] === 'ready' && e[1] === LAN_SERVICE));
    assert.equal((await state()).lanIp, '192.168.1.10');
    // Install over the kept data root never changes the IP (it cannot check
    // shifts and leases there): repair does.
    ctx.lanFacts = { lanIpPresent: true };
    const installed = new Map(ctx.services);
    ctx.services.clear(); // as after an uninstall
    await assert.rejects(
        runInstaller(
            { mode: 'install', ...pinned, lanIp: '192.168.1.20' },
            ctx,
        ),
        /Install with that setting.*-Mode repair -LanIp/,
    );
    for (const [name, value] of installed) ctx.services.set(name, value);
    ctx.lanFacts = { lanIpPresent: true };
    ctx.blockers = { openShifts: 0, activeLeases: 0 };
    ctx.log.length = 0;
    await runInstaller(
        { mode: 'repair', ...pinned, lanIp: '192.168.1.20' },
        ctx,
    );
    assert.equal((await state()).lanIp, '192.168.1.20');
    assert.ok(netsh().some((l) => l.includes('localip=192.168.1.20')));

    // `none` turns LAN terminals off: the LAN service and rule are removed.
    ctx.log.length = 0;
    await runInstaller({ mode: 'repair', ...pinned, lanIp: null }, ctx);
    assert.ok(!ctx.services.has(LAN_SERVICE));
    for (const ext of ['exe', 'xml'])
        assert.ok(
            !existsSync(
                join(
                    ctx.locations.programDir,
                    'services',
                    `${LAN_SERVICE}.${ext}`,
                ),
            ),
            ext,
        );
    assert.ok(
        ctx.log.some(
            (e) =>
                e[0] === 'sc.exe' && e[1] === 'delete' && e[2] === LAN_SERVICE,
        ),
    );
    assert.equal((await state()).lanIp, null);
    assert.ok(ctx.log.some((e) => e[0] === 'provision-lan' && e[1] === null));
    assert.deepEqual(netsh(), [
        `netsh.exe advfirewall firewall delete rule name=${FIREWALL_RULE}`,
        `netsh.exe advfirewall firewall delete rule name=${NTP_FIREWALL_RULE}`,
    ]);
    assert.ok(!ctx.log.some((e) => e[0] === 'w32tm.exe'));
    await rm(dir, { recursive: true });
});

test('the main PC serves time to LAN terminals (#398)', () => {
    const steps = timeServerSteps('192.168.1.10');
    const line = (s) => `${s.file} ${s.args.join(' ')}`;
    assert.equal(
        line(steps[0]),
        `netsh.exe advfirewall firewall delete rule name=${NTP_FIREWALL_RULE}`,
    );
    assert.equal(steps[0].allowFailure, true);
    const lines = steps.map(line);
    assert.ok(
        lines.some(
            (l) =>
                l.startsWith('reg.exe add ') &&
                l.includes('W32Time\\TimeProviders\\NtpServer') &&
                l.includes('/v Enabled /t REG_DWORD /d 1 /f'),
        ),
    );
    assert.ok(lines.includes('sc.exe config w32time start= auto'));
    assert.ok(lines.includes('sc.exe triggerinfo w32time delete'));
    assert.ok(lines.includes('w32tm.exe /config /reliable:yes /update'));
    // Restarted after the provider is enabled, before /reliable is applied.
    assert.ok(
        lines.indexOf('net.exe start w32time') >
            lines.findIndex((l) => l.startsWith('reg.exe')),
    );
    const add = steps.at(-1).args;
    for (const arg of [
        'dir=in',
        'action=allow',
        'protocol=UDP',
        'localport=123',
        'localip=192.168.1.10',
        'remoteip=localsubnet',
        'profile=private',
    ])
        assert.ok(add.includes(arg), arg);
    assert.ok(!add.some((a) => /any|0\.0\.0\.0|public|domain/i.test(a)));
    // No LAN IP: the rule is only deleted.
    assert.deepEqual(timeServerSteps(null), [steps[0]]);
    // Uninstall removes it too.
    assert.ok(
        uninstallSteps({ installedServices: [], shortcuts: [] })
            .map(line)
            .includes(
                `netsh.exe advfirewall firewall delete rule name=${NTP_FIREWALL_RULE}`,
            ),
    );
});

test('installer arguments are validated per mode', () => {
    assert.throws(() => parseArgs([]), /first argument/);
    assert.throws(() => parseArgs(['install']), /--bundle is required/);
    assert.throws(
        () => parseArgs(['uninstall', '--bundle', 'x']),
        /Unknown option/,
    );
    assert.throws(
        () =>
            parseArgs([
                'repair',
                '--bundle',
                'x',
                '--manifest',
                'm',
                '--manifest-sha256',
                'a'.repeat(64),
                '--backup-time',
                '7pm',
            ]),
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
            '--manifest',
            'm',
            '--manifest-sha256',
            'a'.repeat(64),
            '--admin-username',
            'owner',
            '--backup-time',
            '21:00',
        ]),
        {
            mode: 'install',
            bundle: 'b',
            manifest: 'm',
            manifestSha256: 'a'.repeat(64),
            adminUsername: 'owner',
            backupTime: '21:00',
        },
    );
    const lan = (value, mode = 'repair') =>
        parseArgs([
            mode,
            '--bundle',
            'b',
            '--manifest',
            'm',
            '--manifest-sha256',
            'a'.repeat(64),
            '--lan-ip',
            value,
        ]).lanIp;
    assert.equal(lan('192.168.1.10'), '192.168.1.10');
    assert.equal(lan('10.0.0.5', 'install'), '10.0.0.5');
    assert.equal(lan('172.31.4.2'), '172.31.4.2');
    assert.equal(lan('none'), null);
    for (const bad of [
        '8.8.8.8',
        '127.0.0.1',
        '0.0.0.0',
        '172.32.0.1',
        '192.168.1.256',
        '192.168.01.10',
        'pos.local',
        '::1',
    ])
        assert.throws(() => lan(bad), /private IPv4/, bad);
    assert.throws(
        () => parseArgs(['uninstall', '--lan-ip', '192.168.1.10']),
        /Unknown option/,
    );
    assert.equal(EXIT.REFUSED, 3);
});

// ------------------------------------------------------------ PowerShell

test('the PowerShell scripts are strict, offline and never run downloaded code', async () => {
    for (const name of [
        'Install.ps1',
        'Launch.ps1',
        'ExportReminder.ps1',
        'BackupToUsb.ps1',
        'CheckHealth.ps1',
        'MakeTerminalPackage.ps1',
        'JoinTerminal.ps1',
    ]) {
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
    // Out-of-band manifest hash; verify and run from an admin-only copy.
    assert.match(
        install,
        /\[Parameter\(Mandatory = \$true\)\]\s+\[ValidatePattern\(.\^\[0-9A-Fa-f\]\{64\}\$.\)\]\s+\[string\]\$ManifestSha256/,
    );
    assert.match(install, /\$env:ProgramFiles .Valorthon\\GroceryPOS./);
    assert.match(install, /installer-run-/);
    assert.match(install, /unlisted file/);
    assert.match(install, /& \(Join-Path \$run 'node\\node\.exe'\)/);
    assert.doesNotMatch(
        install,
        /Join-Path \$bundle .release\\node\\node\.exe./,
    );
    const backup = await readFile(new URL('BackupToUsb.ps1', here), 'utf8');
    assert.match(backup, /-Verb RunAs/);
    assert.match(backup, /usb-drives\.mjs/);
    assert.doesNotMatch(backup, /DriveType/);
    assert.ok(
        backup.includes("'^(Refused: |Failed )'"),
        'fixed result lines only',
    );
    assert.ok(
        backup.includes("-notmatch 'mongodb(\\+srv)?://|password|secret'"),
    );
    assert.match(backup, /'create'.*'manual'/s);
    assert.match(backup, /'export', '--data-root'/);
    assert.match(backup, /holds the store's keys/);
    assert.match(backup, /tell your vendor at once/);
    const reminder = await readFile(
        new URL('ExportReminder.ps1', here),
        'utf8',
    );
    assert.match(reminder, /Back up to USB drive/);
    const launch = await readFile(new URL('Launch.ps1', here), 'utf8');
    assert.match(launch, /\/v1\/health\/ready/);
    assert.match(launch, /Tls12/);
});

// ------------------------------------------------------------ USB backup

test('the USB drive list uses the export rule, so USB disks and SSDs are offered', async () => {
    assert.deepEqual(parseLetters('E\r\nC\r\n\r\nf\r\nE\r\nnot a letter\r\n'), [
        'C:\\',
        'E:\\',
        'F:\\',
    ]);
    // C: system NVMe, D: second internal SATA disk, E: USB stick, F: USB
    // SSD (fixed drive type, USB bus), G: SD card, H: installation's disk.
    const facts = {
        'C:\\': {
            diskNumber: 0,
            busType: 'NVMe',
            driveType: 'Fixed',
            isBoot: true,
            isSystem: true,
        },
        'D:\\': { diskNumber: 1, busType: 'SATA', driveType: 'Fixed' },
        'E:\\': { diskNumber: 2, busType: 'USB', driveType: 'Removable' },
        'F:\\': { diskNumber: 3, busType: 'USB', driveType: 'Fixed' },
        'G:\\': { diskNumber: 4, busType: 'SD', driveType: 'Removable' },
        'H:\\': { diskNumber: 5, busType: 'USB', driveType: 'Fixed' },
    };
    const root = { diskNumber: 5 };
    const media = async (letter) => classifyWindows(facts[letter], root);
    assert.deepEqual(
        await acceptableDrives(Object.keys(facts), '/data', media),
        ['E:\\', 'F:\\', 'G:\\'],
    );
    // A drive whose facts cannot be read is never offered.
    assert.deepEqual(
        await acceptableDrives(['Z:\\'], '/data', async () => {
            throw new Error('no facts');
        }),
        [],
    );
});

test('backup failures shown to the owner never carry secrets or connection strings', () => {
    const written = [];
    const original = process.stderr.write;
    process.stderr.write = (text) => (written.push(String(text)), true);
    try {
        report(
            new Error('connect mongodb://gpos_root:s3cret@127.0.0.1:27018/x'),
        );
        report(
            new BackupError(
                'DUMP_FAILED',
                'mongodump failed.',
                'uri: mongodb://gpos_root:s3cret@127.0.0.1:27018',
            ),
        );
    } finally {
        process.stderr.write = original;
    }
    const text = written.join('');
    assert.doesNotMatch(text, /mongodb:\/\/|s3cret|gpos_root/);
    // Every line is one the dialog shows (Refused: / Failed ...).
    for (const line of text.split('\n').filter(Boolean)) {
        assert.match(line, /^(Refused: |Failed )/);
    }
});

// ------------------------------------------------------------ diagnostics (#365)

test('"Check Grocery POS" and "Grocery POS help" shortcuts (owner decisions 2026-11-15)', async () => {
    const paths = layout('/pd/data');
    const check = checkShortcutSpec(paths, '/r');
    assert.equal(check.target, 'powershell.exe');
    assert.match(
        check.arguments,
        /CheckHealth\.ps1 -DataRoot \/pd\/data -Release \/r$/,
    );
    assert.deepEqual(
        loc.checkShortcuts.map((p) => p.split('/').pop()),
        ['Check Grocery POS.lnk', 'Check Grocery POS.lnk'],
    );
    // Public Desktop + common Start menu, like the other shortcuts.
    assert.deepEqual(
        loc.checkShortcuts.map((p) => p.split('/').slice(0, -1).join('/')),
        loc.shortcuts.map((p) => p.split('/').slice(0, -1).join('/')),
    );
    const help = helpShortcutSpec('/r');
    assert.equal(help.target, 'notepad.exe');
    assert.equal(help.arguments, '/r/help/RECOVERY.md');
    // Start menu only.
    assert.equal(loc.helpShortcuts.length, 1);
    assert.match(
        loc.helpShortcuts[0],
        /Start Menu\/Programs\/Grocery POS help\.lnk$/,
    );
    const guide = ownerGuideShortcutSpec('/r');
    assert.equal(guide.target, 'notepad.exe');
    assert.equal(guide.arguments, '/r/help/HANDOVER.md');
    assert.equal(loc.ownerGuideShortcuts.length, 1);
    assert.match(
        loc.ownerGuideShortcuts[0],
        /Start Menu\/Programs\/Grocery POS owner guide\.lnk$/,
    );
    assert.equal(allShortcuts(loc).length, 9);
    const steps = uninstallSteps({
        installedServices: [],
        shortcuts: allShortcuts(loc),
    });
    assert.deepEqual(
        steps.filter((s) => s.kind === 'remove').map((s) => s.path),
        allShortcuts(loc),
    );
    const ps = await readFile(new URL('CheckHealth.ps1', here), 'utf8');
    assert.match(ps, /-Verb RunAs/);
    assert.match(ps, /'check', '--data-root'/);
    assert.match(ps, /'export', '--data-root'/);
    assert.match(ps, /FolderBrowserDialog/);
    assert.match(ps, /help\\RECOVERY\.md/);
});

test('nightly log rotation runs as SYSTEM right after the backup and only rotates logs', () => {
    const paths = layout('/pd/data');
    assert.equal(addMinutes('22:00', 30), '22:30');
    assert.equal(addMinutes('23:45', 30), '00:15');
    const xml = logRotationTaskXml(paths, '/r', '21:30');
    assert.match(xml, /<UserId>S-1-5-18<\/UserId>/);
    assert.match(xml, /T22:00:00<\/StartBoundary>/);
    assert.match(xml, /<DaysInterval>1<\/DaysInterval>/);
    assert.match(xml, /<StartWhenAvailable>true<\/StartWhenAvailable>/);
    assert.match(xml, /<Command>\/r\/node\/node\.exe<\/Command>/);
    assert.match(
        xml,
        /diagnostics\/diagnose\.mjs rotate-logs --data-root \/pd\/data --api \/r\/api<\/Arguments>/,
    );
    assert.match(logRotationTaskXml(paths, '/r'), /T22:30:00<\/StartBoundary>/);
    assert.equal(TASKS.logRotation, '\\GroceryPOS\\Nightly log rotation');
    const steps = uninstallSteps({ installedServices: [], shortcuts: [] });
    assert.ok(
        steps.some(
            (s) =>
                s.file === 'schtasks.exe' && s.args.includes(TASKS.logRotation),
        ),
    );
});

test('Install.ps1 restore modes run only from the verified admin-only copy (#366)', async () => {
    const ps = await readFile(new URL('Install.ps1', here), 'utf8');
    for (const mode of ['restore', 'restore-verify'])
        assert.match(ps, new RegExp(`'${mode}'`));
    // mongod, the Database Tools and the API driver are copied and hashed
    // like node and tools, then used from $run, never from the bundle.
    assert.match(
        ps,
        /if \(\$restoreMode\) \{ \$parts \+= @\('mongodb', 'api'\) \}/,
    );
    assert.match(ps, /foreach \(\$part in \$parts\)/);
    assert.match(ps, /Join-Path \$run 'tools\\backup\\restore\.mjs'/);
    assert.match(
        ps,
        /Join-Path \$run 'tools\\backup\\backup\.mjs'\), 'verify'/,
    );
    assert.match(
        ps,
        /'--mongod', \(Join-Path \$run 'mongodb\\bin\\mongod\.exe'\)/,
    );
    assert.match(
        ps,
        /'--tools', \(Join-Path \$run 'mongodb\\bin'\), '--api', \(Join-Path \$run 'api'\)/,
    );
    assert.doesNotMatch(ps, /Join-Path \$bundle .release\\(mongodb|api|tools)/);
    // Fixed data root, absolute -From, required -Confirm, mode-bound flags.
    assert.match(
        ps,
        /\$dataRoot = Join-Path \$env:ProgramData 'Valorthon\\GroceryPOS'/,
    );
    assert.match(ps, /IsPathRooted\(\$From\)/);
    assert.match(ps, /-Mode restore needs -Confirm/);
    assert.match(ps, /'--confirm', \$Confirm/);
    assert.match(ps, /\(\$From -and -not \$restoreMode\)/);
    assert.match(
        ps,
        /\(\$Confirm -or \$AcceptOpenShifts -or \$AcceptPendingOffline\) -and \$Mode -ne 'restore'/,
    );
    for (const flag of [
        '--accept-open-shifts',
        '--accept-newer-sales',
        '--accept-pending-offline',
    ])
        assert.match(ps, new RegExp(`'${flag}'`));
});

test('"Make terminal package" is a Start menu shortcut removed on uninstall (#397)', () => {
    const loc = locations({ ProgramData: '/pd', PUBLIC: '/pub' });
    const spec = terminalPackageShortcutSpec(layout('/pd/data'), '/r');
    assert.match(
        spec.arguments,
        /MakeTerminalPackage\.ps1 -DataRoot \/pd\/data -Release \/r$/,
    );
    assert.equal(loc.terminalPackageShortcuts.length, 1);
    assert.match(
        loc.terminalPackageShortcuts[0],
        /Start Menu.*Make terminal package\.lnk$/,
    );
    assert.ok(allShortcuts(loc).includes(loc.terminalPackageShortcuts[0]));
});

// ------------------------------------------------------------ #412

test('a failed install resumes with repair once services were touched (#412)', () => {
    assert.equal(resumeMode('install'), 'install');
    assert.equal(resumeMode('install', { servicesTouched: true }), 'repair');
    assert.equal(resumeMode('repair', { servicesTouched: true }), 'repair');
    assert.equal(resumeMode('uninstall'), 'uninstall');
    assert.equal(
        resumeCommand('install', 'ab'.repeat(32), { servicesTouched: true }),
        `.\\Install.ps1 -ManifestSha256 ${'ab'.repeat(32)} -Mode repair`,
    );
    // The repair it names is not refused as "already installed".
    const facts = { ...okFacts, dataRoot: 'ours' };
    const installed = { ...facts, servicesInstalled: [SERVICES.mongo] };
    assert.match(
        evaluatePreflight(installed, 'install').refusals.join(' '),
        /use repair/,
    );
    assert.deepEqual(evaluatePreflight(installed, 'repair').refusals, []);
});

test('a failure while re-registering journals removed services and sets the resume mode (#412)', async () => {
    const dir = await scratch();
    const bundle = await makeBundle(dir);
    const pinned = await pin(bundle);
    const ctx = recordingContext(dir);
    await runInstaller(
        { mode: 'install', ...pinned, adminUsername: 'owner' },
        ctx,
    );
    ctx.progress = undefined;
    ctx.waitServiceGone = async (name) => {
        if (name === SERVICES.api) throw new Error('marked for deletion');
    };
    await assert.rejects(
        runInstaller({ mode: 'repair', ...pinned }, ctx),
        /marked for deletion/,
    );
    assert.equal(ctx.progress.servicesTouched, true);
    const state = JSON.parse(
        await readFile(
            join(layout(ctx.locations.dataRoot).dirs.state, 'installer.json'),
            'utf8',
        ),
    );
    assert.equal(state.complete, false);
    // The API was deleted (marked) when the wait failed; MongoDB never was.
    assert.deepEqual(state.servicesRemoved, [SERVICES.proxy, SERVICES.api]);
    // Repair finishes it and clears the note.
    ctx.waitServiceGone = async () => {};
    await runInstaller({ mode: 'repair', ...pinned }, ctx);
    const after = JSON.parse(
        await readFile(
            join(layout(ctx.locations.dataRoot).dirs.state, 'installer.json'),
            'utf8',
        ),
    );
    assert.equal(after.complete, true);
    assert.equal(after.servicesRemoved, undefined);
});

test('uninstall reports as kept only paths that exist (#412)', async () => {
    const dir = await scratch();
    const ctx = recordingContext(dir);
    await mkdir(ctx.locations.dataRoot, { recursive: true });
    const removed = await runInstaller({ mode: 'uninstall' }, ctx);
    assert.deepEqual(removed.kept, [ctx.locations.dataRoot]);
});

test('the run log buffers until the state folder exists and scrubs secrets (#412)', async () => {
    const dir = await scratch();
    const root = join(dir, 'data');
    const now = new Date('2026-11-17T11:51:00.123Z');
    assert.equal(
        installerLogName(now),
        'installer-2026-11-17T11-51-00-123Z.log',
    );
    const runLog = createRunLog(root, now);
    runLog.write('preflight');
    assert.equal(runLog.flush(), false);
    await mkdir(join(root, 'state'), { recursive: true });
    runLog.write('DATABASE_URL=mongodb://root:hunter2@127.0.0.1:27017/x');
    runLog.write('password: s3cret');
    runLog.write('JWT_SECRET=abc1');
    runLog.write('MONGO_PASSWORD=x2y');
    runLog.write('{"cookieSecret":"zz9"}');
    assert.equal(runLog.flush(), true);
    assert.equal(runLog.path, join(root, 'state', installerLogName(now)));
    const text = await readFile(runLog.path, 'utf8');
    assert.match(text, /preflight\n/);
    assert.ok(!text.includes('hunter2'));
    for (const secret of ['s3cret', 'abc1', 'x2y', 'zz9'])
        assert.ok(!text.includes(secret), secret);
    assert.equal(text.trim().split('\n').length, 6);
});

test('a readiness timeout quotes the service error log, redacted (#412)', async () => {
    const paths = layout('/data');
    assert.equal(
        serviceErrorLog(SERVICES.proxy, paths),
        join(paths.proxyLogs, `${SERVICES.proxy}.err.log`),
    );
    assert.equal(serviceErrorLog(SERVICES.mongo, paths), paths.mongodLog);
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    lines.push('Error: token=abcdef parsing Caddyfile');
    const message = await readinessFailure(SERVICES.proxy, paths, async () => ({
        text: lines.join('\r\n'),
    }));
    assert.match(message, /did not become ready/);
    assert.match(message, /parsing Caddyfile/);
    // Plain log text survives (#414); only secret-shaped values go.
    assert.match(message, /line 29/);
    assert.doesNotMatch(message, /\[text\]/);
    assert.ok(!message.includes('abcdef'));
    assert.ok(!message.includes('line 10\n'));
    assert.match(message, /line 11/);
    assert.ok(!message.endsWith('\n'));
    assert.match(
        await readinessFailure(SERVICES.api, paths, async () => null),
        /empty or missing/,
    );
});

test('the resume command carries the operator flags (#412)', async () => {
    const hash = 'cd'.repeat(32);
    assert.equal(
        resumeCommand(
            'install',
            hash,
            {},
            {
                adminUsername: 'owner',
                storeTimezone: 'Asia/Manila',
                lanIp: '192.168.1.10',
                backupTime: '21:30',
            },
        ),
        `.\\Install.ps1 -ManifestSha256 ${hash} -Mode install -AdminUsername owner -StoreTimezone Asia/Manila -LanIp 192.168.1.10 -BackupTime 21:30`,
    );
    assert.equal(
        resumeCommand(
            'install',
            hash,
            { servicesTouched: true },
            {
                adminUsername: 'owner',
                lanIp: null,
            },
        ),
        `.\\Install.ps1 -ManifestSha256 ${hash} -Mode repair -LanIp none`,
    );
    // A failure before any state exists still resumes as the same install.
    const dir = await scratch();
    const bundle = await makeBundle(dir);
    const pinned = await pin(bundle);
    const ctx = recordingContext(dir, { failProvisionOnce: true });
    const options = { mode: 'install', ...pinned, adminUsername: 'owner' };
    await assert.rejects(runInstaller(options, ctx), /power cut/);
    assert.equal(ctx.progress, undefined);
    assert.match(
        resumeCommand('install', pinned.manifestSha256, ctx.progress, options),
        /-Mode install -AdminUsername owner$/,
    );
});

test('the trusted proxy check runs node --use-system-ca with no CA (#414)', async () => {
    const calls = [];
    const url = 'https://localhost:1443/v1/health/ready';
    const result = await proxyReady({
        url,
        trusted: true,
        ca: 'ignored',
        node: '/bundle/node.exe',
        exec: async (file, args) => (
            calls.push([file, args]),
            {
                code: 0,
                stdout: '{"ok":false,"error":"UNABLE_TO_GET_ISSUER_CERT_LOCALLY"}\n',
                stderr: '',
            }
        ),
    });
    assert.deepEqual(result, {
        ok: false,
        error: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    });
    assert.deepEqual(calls, [['/bundle/node.exe', systemTrustProbeArgs(url)]]);
    assert.equal(calls[0][1][0], '--use-system-ca');
    assert.ok(!calls[0][1].includes('ignored'));
    const broken = await proxyReady({
        url,
        trusted: true,
        node: 'node',
        exec: async () => ({
            code: 9,
            stdout: '',
            stderr: 'bad option: --use-system-ca',
        }),
    });
    assert.equal(broken.ok, false);
    assert.match(broken.error, /exit 9: bad option/);
});

test('trusted vs root.crt against a real self-signed proxy (#414)', async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'gpos-trust-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const key = join(dir, 'key.pem');
    const crt = join(dir, 'crt.pem');
    try {
        execFileSync(
            'openssl',
            [
                'req',
                '-x509',
                '-newkey',
                'ec',
                '-pkeyopt',
                'ec_paramgen_curve:P-256',
                '-nodes',
                '-keyout',
                key,
                '-out',
                crt,
                '-subj',
                '/CN=localhost',
                '-addext',
                'subjectAltName=DNS:localhost',
                '-days',
                '2',
            ],
            { stdio: 'ignore' },
        );
    } catch {
        t.skip('openssl not available');
        return;
    }
    const { createServer } = await import('node:https');
    const cert = await readFile(crt);
    const server = createServer({ key: await readFile(key), cert }, (_q, r) =>
        r.end('ok'),
    );
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    t.after(() => server.close());
    const url = `https://localhost:${server.address().port}/v1/health/ready`;
    const exec = (file, args) =>
        new Promise((done) =>
            execFile(file, args, (e, stdout, stderr) =>
                done({ code: e ? 1 : 0, stdout, stderr }),
            ),
        );
    // The machine's trust store does not hold this root: the trusted
    // check must fail with the TLS reason, never pass.
    const trusted = await proxyReady({
        url,
        trusted: true,
        exec,
        node: process.execPath,
    });
    assert.equal(trusted.ok, false);
    assert.match(trusted.error, /SELF_SIGNED|ISSUER|UNABLE/);
    assert.deepEqual(
        await proxyReady({
            url,
            trusted: false,
            ca: cert,
            exec,
            node: process.execPath,
        }),
        { ok: true },
    );
});

test('a readiness timeout names the last check error (#414)', async () => {
    const message = await readinessFailure(
        SERVICES.proxy,
        layout('/data'),
        async () => null,
        20,
        'UNABLE_TO_GET_ISSUER_CERT_LOCALLY (checked with the Windows trust store)',
    );
    assert.match(message, /last check: UNABLE_TO_GET_ISSUER_CERT_LOCALLY/);
});
