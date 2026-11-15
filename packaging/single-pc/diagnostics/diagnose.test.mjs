// Portable diagnostics checks (#365) with a fake context: every failure
// maps to plain steps, redaction holds, backups come from status.json.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
    mkdir,
    mkdtemp,
    open,
    readFile,
    readdir,
    rm,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { SERVICES, layout } from '../runtime/layout.mjs';
import {
    CHECK_IDS,
    EXPORT_INCLUDES,
    GUIDANCE,
    REPORT_KEYS,
    STATUSES,
    logLine,
    rotateReason,
    serviceStateFromStatus,
    supportExport,
    tailFile,
    diagnose,
    errorLines,
    parseArgs,
    redact,
    renderText,
} from './diagnose.mjs';

const NOW = new Date('2026-11-15T03:00:00.000Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600e3).toISOString();

let root;
let release;

async function writeStatus(status) {
    const paths = layout(root);
    await writeFile(
        paths.backupStatus,
        JSON.stringify({ schema: 1, updatedAt: hoursAgo(1), ...status }),
    );
}

function healthy(overrides = {}) {
    const files = new Map();
    return {
        now: () => NOW,
        readText: async (path) => {
            if (files.has(path)) return files.get(path);
            const { readFile } = await import('node:fs/promises');
            return readFile(path, 'utf8');
        },
        list: async () => ['GroceryPOS-API.err.log'],
        tail: async (path) =>
            path.endsWith('mongod.log')
                ? { size: 1000, text: '{"s":"I","msg":"ok"}\n' }
                : { size: 10, text: 'info line\n' },
        tcp: async () => true,
        listeners: async (port) =>
            port === 1443 ? ['127.0.0.1', '::1'] : ['127.0.0.1'],
        mongoHello: async () => ({ setName: 'gpos', isWritablePrimary: true }),
        http: async () => ({ status: 200 }),
        https: async () => ({ status: 200 }),
        serviceStates: async () =>
            Object.fromEntries(
                Object.values(SERVICES).map((n) => [n, 'RUNNING']),
            ),
        freeSpace: async () => ({
            free: 100 * 1024 ** 3,
            total: 200 * 1024 ** 3,
        }),
        ...overrides,
    };
}

const byId = (report, id) => report.checks.find((c) => c.id === id);

before(async () => {
    root = await mkdtemp(join(tmpdir(), 'gpos-diag-'));
    release = join(root, 'program', 'releases', '1.2.3');
    const paths = layout(root);
    for (const dir of Object.values(paths.dirs))
        await mkdir(dir, { recursive: true });
    await mkdir(release, { recursive: true });
    await writeFile(
        join(paths.dirs.state, 'installer.json'),
        JSON.stringify({
            version: '1.2.3',
            release,
            adminUsername: 'owner-name',
            stages: { release: hoursAgo(48) },
            complete: true,
        }),
    );
    await writeFile(
        join(release, 'VERSION.json'),
        JSON.stringify({
            version: '1.2.3',
            appVersion: '0.0.1',
            commit: 'abc',
            builtAt: hoursAgo(72),
            components: { node: { version: '22.0.0', sha256: 'x' } },
        }),
    );
});

after(() => rm(root, { recursive: true, force: true }));

describe('diagnose', () => {
    test('all healthy except the unverifiable certificate', async () => {
        await writeStatus({
            lastAttempt: { at: hoursAgo(5) },
            lastSuccess: { at: hoursAgo(5) },
            lastVerifiedSuccess: { at: hoursAgo(5), backupId: 'b1' },
            lastExport: { at: hoursAgo(24) },
        });
        const report = await diagnose({ dataRoot: root }, healthy());
        for (const c of report.checks)
            if (c.id !== 'proxy')
                assert.ok(['ok', 'info'].includes(c.status), c.id);
        assert.equal(byId(report, 'proxy').status, 'unknown');
        assert.equal(
            byId(report, 'versions').details.components.node,
            '22.0.0',
        );
        assert.doesNotMatch(JSON.stringify(report), /owner-name/);
        assert.match(renderText(report), /\[OK\] Backups/);
    });

    test('API down: application fails, listening database stays OK', async () => {
        const report = await diagnose(
            { dataRoot: root },
            healthy({
                http: async () => ({ error: 'ECONNREFUSED' }),
                https: async () => ({ status: 502 }),
                tcp: async (_h, port) => port !== 13000,
                serviceStates: async () => ({
                    [SERVICES.mongo]: 'RUNNING',
                    [SERVICES.api]: 'STOPPED',
                    [SERVICES.proxy]: 'RUNNING',
                }),
            }),
        );
        assert.equal(byId(report, 'database').status, 'ok');
        assert.equal(byId(report, 'api').status, 'fail');
        assert.deepEqual(byId(report, 'api').steps, GUIDANCE.serviceStopped);
        assert.match(
            byId(report, 'services').summary,
            /GroceryPOS-API \(STOPPED\)/,
        );
        assert.equal(byId(report, 'proxy').details.tls, 'unverified');
        assert.equal(report.overall, 'fail');
    });

    test('API listening but database unusable is distinguished', async () => {
        const report = await diagnose(
            { dataRoot: root },
            healthy({
                http: async (url) => ({
                    status: url.endsWith('/ready') ? 503 : 200,
                }),
                mongoHello: async () => ({
                    error: 'MongoServerSelectionError',
                }),
            }),
        );
        assert.match(
            byId(report, 'api').summary,
            /running but cannot use the database/,
        );
        assert.equal(byId(report, 'database').status, 'fail');
    });

    test('database recovering (not primary)', async () => {
        const report = await diagnose(
            { dataRoot: root },
            healthy({
                mongoHello: async () => ({
                    setName: 'gpos',
                    isWritablePrimary: false,
                }),
            }),
        );
        assert.deepEqual(
            byId(report, 'database').steps,
            GUIDANCE.databaseNotPrimary,
        );
    });

    test('a non-loopback listener is a failure', async () => {
        const report = await diagnose(
            { dataRoot: root },
            healthy({
                listeners: async (p) =>
                    p === 13000 ? ['0.0.0.0'] : ['127.0.0.1', '::1'],
            }),
        );
        assert.equal(byId(report, 'ports').status, 'fail');
        assert.deepEqual(byId(report, 'ports').steps, GUIDANCE.exposed);
    });

    test('low and full disk', async () => {
        const low = await diagnose(
            { dataRoot: root },
            healthy({
                freeSpace: async () => ({
                    free: 2 * 1024 ** 3,
                    total: 10 * 1024 ** 3,
                }),
            }),
        );
        assert.equal(byId(low, 'disk').status, 'warn');
        const full = await diagnose(
            { dataRoot: root },
            healthy({
                freeSpace: async () => ({
                    free: 1 * 1024 ** 3,
                    total: 20 * 1024 ** 3,
                }),
            }),
        );
        assert.equal(byId(full, 'disk').status, 'fail');
        assert.deepEqual(byId(full, 'disk').steps, GUIDANCE.diskFull);
    });

    test('backup failure, overdue and export reminder come from status.json', async () => {
        await writeStatus({
            lastVerifiedSuccess: { at: hoursAgo(30) },
            lastFailure: {
                at: hoursAgo(2),
                command: 'create',
                code: 'LOW_DISK',
                message: 'mongodb://gpos_root:secretpw@127.0.0.1 failed',
            },
            lastExport: { at: hoursAgo(1) },
        });
        let report = await diagnose({ dataRoot: root }, healthy());
        const backups = byId(report, 'backups');
        assert.equal(backups.status, 'fail');
        assert.match(backups.summary, /LOW_DISK/);
        assert.doesNotMatch(JSON.stringify(report), /secretpw/);

        await writeStatus({
            lastVerifiedSuccess: { at: hoursAgo(40) },
            lastExport: { at: hoursAgo(1) },
        });
        report = await diagnose({ dataRoot: root }, healthy());
        assert.match(byId(report, 'backups').summary, /overdue/);

        await writeStatus({});
        report = await diagnose({ dataRoot: root }, healthy());
        assert.match(byId(report, 'backups').summary, /no verified backup yet/);

        await writeStatus({
            lastVerifiedSuccess: { at: hoursAgo(3) },
            lastExport: { at: hoursAgo(24 * 8) },
        });
        report = await diagnose({ dataRoot: root }, healthy());
        assert.equal(byId(report, 'backups').status, 'warn');
        assert.deepEqual(byId(report, 'backups').steps, GUIDANCE.exportDue);

        // A backup folder on disk is never taken as success.
        await mkdir(
            join(layout(root).dirs.backups, 'scheduled-20261115T000000Z'),
            { recursive: true },
        );
        await writeStatus({ lastExport: { at: hoursAgo(1) } });
        report = await diagnose({ dataRoot: root }, healthy());
        assert.equal(byId(report, 'backups').status, 'fail');

        await writeFile(layout(root).backupStatus, '{broken');
        report = await diagnose({ dataRoot: root }, healthy());
        assert.deepEqual(
            byId(report, 'backups').steps,
            GUIDANCE.backupStatusUnreadable,
        );
    });

    test('clock behind recorded activity', async () => {
        await writeStatus({
            updatedAt: new Date(NOW.getTime() + 3600e3).toISOString(),
        });
        const report = await diagnose({ dataRoot: root }, healthy());
        assert.equal(byId(report, 'clock').status, 'fail');
    });

    test('incomplete installation and large database log', async () => {
        const report = await diagnose(
            { dataRoot: join(root, 'nothing-here') },
            healthy({
                tail: async (p) =>
                    p.endsWith('mongod.log')
                        ? { size: 200 * 1024 ** 2, text: '' }
                        : null,
            }),
        );
        assert.equal(byId(report, 'versions').status, 'fail');
        assert.equal(byId(report, 'logs').status, 'warn');
    });

    test('Linux has no service state', async () => {
        const report = await diagnose(
            { dataRoot: root },
            healthy({ serviceStates: async () => null }),
        );
        assert.equal(byId(report, 'services').status, 'unknown');
    });
});

describe('redaction and logs', () => {
    test('secrets, tokens, emails and profile names are removed; request ids stay', () => {
        const secret = 'A'.repeat(64);
        const line = redact(
            `ERROR requestId=3f2b8c1e-9d4a-4c1b-8f2e-1a2b3c4d5e6f DATABASE_URL=mongodb://gpos_api:${secret}@127.0.0.1 ` +
                `password: hunter2 Cookie: sid=abc Bearer abc.def eyJhbGciOi.eyJzdWIi.sig ` +
                `owner@example.com C:\\Users\\Maria\\x /home/maria/y ${secret}`,
        );
        for (const bad of [
            secret,
            'hunter2',
            'sid=abc',
            'abc.def',
            'eyJhbGciOi',
            'owner@example.com',
            'Maria',
            'maria',
        ])
            assert.ok(!line.includes(bad), bad);
        assert.match(line, /3f2b8c1e-9d4a-4c1b-8f2e-1a2b3c4d5e6f/);
    });

    test('error lines from text and mongod JSON logs', () => {
        const text = [
            '{"s":"I","msg":"fine"}',
            '{"s":"E","msg":"bad"}',
            '[Nest] ERROR [GlobalFilter] 500 GET /v1/sales',
            'ok line',
        ].join('\n');
        assert.deepEqual(errorLines(text).length, 2);
    });

    test('arguments', () => {
        assert.deepEqual(parseArgs(['check', '--data-root', '/x', '--json']), {
            command: 'check',
            dataRoot: '/x',
            json: true,
        });
        assert.throws(() => parseArgs(['rotate-logs', '--data-root', '/x']));
        assert.throws(() => parseArgs(['upload', '--data-root', '/x']));
        assert.throws(() => parseArgs(['check']));
    });
});

describe('review fixes and owner decisions (#365)', () => {
    test('tail reads only the end of a huge (sparse) file', async () => {
        const file = join(root, 'huge.log');
        const handle = await open(file, 'w');
        await handle.truncate(3 * 1024 ** 3); // 3 GB sparse, beyond readFile's limit
        await handle.write('partial\n{"s":"E","msg":"last"}\n', 3 * 1024 ** 3);
        await handle.close();
        const tail = await tailFile(file, 1024);
        assert.ok(tail.size > 3 * 1024 ** 3);
        assert.match(tail.text, /"msg":"last"/);
        assert.equal(errorLines(tail.text).length, 1);
        await rm(file);
    });

    test('without the local root the proxy is unverified, never HTTPS', async () => {
        let httpsCalls = 0;
        const report = await diagnose(
            { dataRoot: root },
            healthy({ https: async () => (httpsCalls++, { status: 200 }) }),
        );
        const proxy = byId(report, 'proxy');
        assert.equal(httpsCalls, 0);
        assert.equal(proxy.status, 'unknown');
        assert.equal(proxy.details.tls, 'unverified');
        assert.match(proxy.summary, /unverified/);
        assert.doesNotMatch(JSON.stringify(report), /"verified"/);
    });

    test('with the local root the proxy is verified', async (t) => {
        let pem;
        try {
            pem = execFileSync(
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
                    '/dev/null',
                    '-subj',
                    '/CN=test',
                    '-days',
                    '3650',
                ],
                { stdio: ['ignore', 'pipe', 'ignore'] },
            ).toString();
        } catch {
            t.skip('openssl not available');
            return;
        }
        let ca;
        const report = await diagnose(
            { dataRoot: root },
            healthy({
                readText: async (p) =>
                    p.endsWith('root.crt') ? pem : readFile(p, 'utf8'),
                https: async (_u, given) => ((ca = given), { status: 200 }),
            }),
        );
        assert.equal(ca, pem);
        assert.equal(byId(report, 'proxy').status, 'ok');
        assert.equal(byId(report, 'proxy').details.tls, 'verified');
    });

    test('redaction: every cookie value, IPs, user names, mongod attr', () => {
        const line = redact(
            'WARN [abc] Cookie: a=1; refresh=shortvalue; marker=1 from 192.168.1.20 and fe80::1 and ::ffff:10.0.0.1 and 2001:db8:0:0:0:0:0:1',
        );
        for (const bad of [
            'shortvalue',
            'marker=1',
            '192.168.1.20',
            'fe80::1',
            '10.0.0.1',
            '2001:db8',
        ])
            assert.ok(!line.includes(bad), `${bad} in ${line}`);
        const ips = redact(
            'from 192.168.1.20 and fe80::1 and ::ffff:10.0.0.1 and 2001:db8:0:0:0:0:0:1 at 12:30:45',
        );
        for (const bad of ['192.168', 'fe80', 'ffff', '10.0.0.1', '2001'])
            assert.ok(!ips.includes(bad), `${bad} in ${ips}`);
        assert.match(ips, /12:30:45/);
        const dup = redact(
            '[3f2b8c1e-9d4a-4c1b-8f2e-1a2b3c4d5e6f] POST /v1/users -> 400 DB_DUPLICATE_KEY: MongoServerError: E11000 dup key: { name: "maria" } user=juan by: pedro',
        );
        for (const bad of ['maria', 'juan', 'pedro'])
            assert.ok(!dup.includes(bad), `${bad} in ${dup}`);
        assert.match(dup, /3f2b8c1e-9d4a-4c1b-8f2e-1a2b3c4d5e6f/);
        assert.match(dup, /POST \/v1\/users -> 400 DB_DUPLICATE_KEY/);
        const mongo = logLine(
            JSON.stringify({
                t: { $date: '2026-11-15T00:00:00Z' },
                s: 'I',
                c: 'ACCESS',
                id: 20250,
                msg: 'Auth ok',
                attr: { user: 'gpos_api', remote: '127.0.0.1:5000' },
            }),
        );
        assert.equal(mongo, '2026-11-15T00:00:00Z I ACCESS 20250 Auth ok');
    });

    test('service states are read from the locale-independent enum', () => {
        assert.equal(serviceStateFromStatus('Running\r\n'), 'RUNNING');
        assert.equal(serviceStateFromStatus('Stopped'), 'STOPPED');
        assert.equal(serviceStateFromStatus(''), 'absent');
        assert.equal(serviceStateFromStatus('Läuft'), 'UNKNOWN');
    });

    test('rotate-logs failures name their cause', () => {
        assert.match(
            rotateReason({ name: 'MongoServerSelectionError' }),
            /not running/,
        );
        assert.match(
            rotateReason({
                name: 'MongoServerError',
                code: 18,
                codeName: 'AuthenticationFailed',
            }),
            /credentials/,
        );
        assert.match(
            rotateReason({
                name: 'MongoServerError',
                code: 13,
                codeName: 'Unauthorized',
            }),
            /may not/,
        );
    });

    test('JSON report keys, check ids and status values are pinned', async () => {
        const report = await diagnose({ dataRoot: root }, healthy());
        assert.deepEqual(Object.keys(report), [...REPORT_KEYS]);
        assert.deepEqual(
            report.checks.map((c) => c.id),
            [...CHECK_IDS],
        );
        assert.deepEqual(
            [...STATUSES],
            ['ok', 'info', 'unknown', 'warn', 'fail'],
        );
        for (const c of report.checks) {
            assert.ok(STATUSES.includes(c.status));
            assert.deepEqual(Object.keys(c).slice(0, 5), [
                'id',
                'title',
                'status',
                'summary',
                'steps',
            ]);
        }
        assert.equal(report.guide, join(release, 'help', 'RECOVERY.md'));
        assert.match(renderText(report), /Recovery guide: .*RECOVERY\.md/);
    });

    test('support export: report + redacted log lines, nothing else', async () => {
        const out = await mkdtemp(join(tmpdir(), 'gpos-usb-'));
        try {
            const file = await supportExport(
                { dataRoot: root, to: out },
                healthy({
                    tail: async (p) =>
                        p.endsWith('mongod.log')
                            ? {
                                  size: 10,
                                  text:
                                      JSON.stringify({
                                          s: 'E',
                                          c: 'NET',
                                          id: 1,
                                          msg: 'boom',
                                          attr: { remote: '10.1.2.3:4' },
                                      }) + '\n',
                              }
                            : {
                                  size: 10,
                                  text: 'ERROR password=hunter2 Cookie: s=abc; t=def owner@example.com 10.0.0.5\nok\n',
                              },
                }),
            );
            assert.deepEqual(await readdir(out), [file.split(/[\\/]/).pop()]);
            const text = await readFile(file, 'utf8');
            for (const bad of [
                'hunter2',
                's=abc',
                't=def',
                'owner@example.com',
                '10.0.0.5',
                '10.1.2.3',
                'owner-name',
            ])
                assert.ok(!text.includes(bad), bad);
            const content = JSON.parse(text);
            assert.deepEqual(Object.keys(content), [
                'schema',
                'kind',
                'createdAt',
                'includes',
                'report',
                'logs',
            ]);
            assert.deepEqual(content.includes, [...EXPORT_INCLUDES]);
            assert.deepEqual(Object.keys(content.logs), [
                'database',
                'application',
                'proxy',
            ]);
            assert.match(content.logs.database[0], /boom/);
            await assert.rejects(
                supportExport(
                    { dataRoot: root, to: layout(root).dirs.backups },
                    healthy(),
                ),
                /outside/,
            );
            await assert.rejects(
                supportExport(
                    { dataRoot: root, to: join(out, 'missing') },
                    healthy(),
                ),
                /does not exist/,
            );
        } finally {
            await rm(out, { recursive: true, force: true });
        }
        assert.deepEqual(
            parseArgs(['export', '--data-root', '/x', '--to', '/y']),
            { command: 'export', dataRoot: '/x', to: '/y' },
        );
        assert.throws(() => parseArgs(['export', '--data-root', '/x']));
        assert.throws(() =>
            parseArgs(['check', '--data-root', '/x', '--to', '/y']),
        );
    });
});
