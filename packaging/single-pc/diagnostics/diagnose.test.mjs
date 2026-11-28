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
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { LAN_SERVICE, SERVICES, layout } from '../runtime/layout.mjs';
import {
    CHECK_IDS,
    EXPORT_INCLUDES,
    QUERIED_SERVICES,
    GUIDANCE,
    REPORT_KEYS,
    STATUSES,
    logLine,
    rotateReason,
    serviceStateFromStatus,
    supportExport,
    scrubIps,
    tailFile,
    diagnose,
    isAccessDenied,
    errorLines,
    firewallProbeScript,
    parseFirewallProbe,
    parseLanAddress,
    parseTimeServer,
    parseClockSync,
    parseArgs,
    redact,
    renderText,
    checkExitCode,
    onlyAdminUnverified,
    EXIT,
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
        clockSync: async () => ({
            state: 'RUNNING',
            startType: 'Manual',
            syncType: 'NTP',
            source: 'time.windows.com,0x9',
        }),
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

    test('a database that does not answer hints at AVX when absent or unknown (#489)', async () => {
        for (const avx of [false, null]) {
            const check = byId(
                await diagnose(
                    { dataRoot: root },
                    healthy({
                        avx: async () => avx,
                        mongoHello: async () => ({ error: 'ECONNREFUSED' }),
                    }),
                ),
                'database',
            );
            assert.equal(check.status, 'fail');
            assert.match(check.summary, /the processor may not support AVX/);
            assert.deepEqual(check.steps, [
                ...GUIDANCE.noAvx,
                ...GUIDANCE.portClosed,
            ]);
        }
        const withAvx = byId(
            await diagnose(
                { dataRoot: root },
                healthy({
                    avx: async () => true,
                    mongoHello: async () => ({ error: 'ECONNREFUSED' }),
                }),
            ),
            'database',
        );
        assert.doesNotMatch(withAvx.summary, /AVX/);
        assert.deepEqual(withAvx.steps, GUIDANCE.portClosed);
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

    test('the real context queries the three services and the LAN proxy (#396)', () => {
        assert.deepEqual(
            [...QUERIED_SERVICES],
            [...Object.values(SERVICES), LAN_SERVICE],
        );
        const source = readFileSync(
            new URL('./diagnose.mjs', import.meta.url),
            'utf8',
        );
        const real = source.slice(
            source.indexOf('export function realContext'),
        );
        assert.match(
            real.slice(0, real.indexOf('async listeners')),
            /for \(const name of QUERIED_SERVICES\)/,
        );
    });

    test('any LAN service state but STOPPED may hold the LAN listener (#396)', async () => {
        const paths = layout(root);
        for (const [lanState, status] of [
            ['START_PENDING', 'ok'],
            ['STOP_PENDING', 'ok'],
            ['STOPPED', 'fail'],
        ]) {
            const report = await diagnose(
                { dataRoot: root },
                healthy({
                    readText: async (path) =>
                        path === paths.runtimeManifest
                            ? JSON.stringify({ lanIp: '192.168.1.10' })
                            : (await import('node:fs/promises')).readFile(
                                  path,
                                  'utf8',
                              ),
                    serviceStates: async () => ({
                        ...Object.fromEntries(
                            Object.values(SERVICES).map((n) => [n, 'RUNNING']),
                        ),
                        [LAN_SERVICE]: lanState,
                    }),
                    listeners: async (p) =>
                        p === 1443
                            ? ['127.0.0.1', '::1', '192.168.1.10']
                            : ['127.0.0.1'],
                }),
            );
            assert.equal(byId(report, 'ports').status, status, lanState);
        }
    });

    test('unreadable LAN settings make the LAN listener unknown, never a stop-selling FAIL (#499)', async () => {
        const paths = layout(root);
        const deniedCtx = (listeners, lanState = 'RUNNING') =>
            healthy({
                serviceStates: async () => ({
                    ...Object.fromEntries(
                        Object.values(SERVICES).map((n) => [n, 'RUNNING']),
                    ),
                    ...(lanState ? { [LAN_SERVICE]: lanState } : {}),
                }),
                readText: async (path) => {
                    if (path === paths.runtimeManifest)
                        throw Object.assign(new Error('EPERM'), {
                            code: 'EPERM',
                        });
                    return (await import('node:fs/promises')).readFile(
                        path,
                        'utf8',
                    );
                },
                listeners,
            });
        const report = await diagnose(
            { dataRoot: root },
            deniedCtx(async (p) =>
                p === 1443
                    ? ['127.0.0.1', '::1', '192.168.1.10']
                    : ['127.0.0.1'],
            ),
        );
        const ports = byId(report, 'ports');
        assert.equal(ports.status, 'unknown');
        assert.match(ports.summary, /administrator/);
        assert.deepEqual(ports.steps, []);
        for (const id of ['lanProxy', 'lanNetwork', 'timeServer'])
            assert.equal(byId(report, id).status, 'unknown', id);
        assert.doesNotMatch(
            renderText(report),
            /do not keep selling|No LAN terminals/,
        );

        // Real exposures still fail: a public address on the proxy port,
        // or any non-loopback listener on the database or application.
        for (const listeners of [
            async (p) =>
                p === 1443 ? ['127.0.0.1', '::1', '8.8.8.8'] : ['127.0.0.1'],
            async (p) =>
                p === 1443
                    ? ['127.0.0.1', '::1']
                    : ['127.0.0.1', '192.168.1.10'],
            async () => ['0.0.0.0'],
        ]) {
            const r = await diagnose({ dataRoot: root }, deniedCtx(listeners));
            assert.equal(byId(r, 'ports').status, 'fail');
        }
        // Two private addresses: only one LAN IP can be configured.
        for (const extra of [
            ['0.0.0.0'],
            ['::'],
            ['192.168.1.10', '10.0.0.5'],
        ]) {
            const r = await diagnose(
                { dataRoot: root },
                deniedCtx(async (p) =>
                    p === 1443 ? ['127.0.0.1', '::1', ...extra] : ['127.0.0.1'],
                ),
            );
            assert.equal(byId(r, 'ports').status, 'fail', extra.join());
        }
        // The LAN service absent or stopped: the listener is someone else's.
        for (const lanState of [null, 'STOPPED']) {
            const r = await diagnose(
                { dataRoot: root },
                deniedCtx(
                    async (p) =>
                        p === 1443
                            ? ['127.0.0.1', '::1', '192.168.1.10']
                            : ['127.0.0.1'],
                    lanState,
                ),
            );
            assert.equal(byId(r, 'ports').status, 'fail', String(lanState));
        }
    });

    test('services: the running count includes the LAN proxy (#508)', async () => {
        const states = Object.fromEntries(
            Object.values(SERVICES).map((n) => [n, 'RUNNING']),
        );
        const run = async (lan) =>
            byId(
                await diagnose(
                    { dataRoot: root },
                    healthy({
                        serviceStates: async () =>
                            lan ? { ...states, [LAN_SERVICE]: lan } : states,
                    }),
                ),
                'services',
            );
        const three = Object.values(SERVICES).length;
        assert.equal(
            (await run(null)).summary,
            `All ${three} services are running.`,
        );
        assert.equal(
            (await run('RUNNING')).summary,
            `All ${three + 1} services are running.`,
        );
        for (const lan of ['STOPPED', 'absent'])
            assert.equal(
                (await run(lan)).summary,
                `All ${three} services are running.`,
            );
    });

    test('services: a configured LAN proxy that is down is counted and warned (#529)', async () => {
        const paths = layout(root);
        const states = Object.fromEntries(
            Object.values(SERVICES).map((n) => [n, 'RUNNING']),
        );
        const run = async (lan) =>
            diagnose(
                { dataRoot: root },
                healthy({
                    readText: async (path) =>
                        path === paths.runtimeManifest
                            ? JSON.stringify({ lanIp: '192.168.1.10' })
                            : (await import('node:fs/promises')).readFile(
                                  path,
                                  'utf8',
                              ),
                    serviceStates: async () => ({
                        ...states,
                        [LAN_SERVICE]: lan,
                    }),
                    listeners: async (p) =>
                        p === 1443 && lan === 'RUNNING'
                            ? ['127.0.0.1', '::1', '192.168.1.10']
                            : ['127.0.0.1', '::1'],
                }),
            );
        const total = Object.values(SERVICES).length + 1;
        const stopped = await run('STOPPED');
        const svc = byId(stopped, 'services');
        assert.equal(svc.status, 'warn');
        assert.equal(
            svc.summary,
            `${total - 1} of ${total} services are running: GroceryPOS-ProxyLan is not running (STOPPED), so LAN terminals cannot connect; selling on this PC still works.`,
        );
        assert.deepEqual(svc.steps, GUIDANCE.lanServiceStopped);
        assert.match(svc.steps.join(' '), /choose Start, or restart the PC/);
        assert.match(svc.steps.join(' '), /repair mode/);
        assert.deepEqual(
            byId(stopped, 'lanProxy').steps,
            GUIDANCE.lanServiceStopped,
        );
        assert.doesNotMatch(
            byId(stopped, 'lanProxy').steps.join(' '),
            /network cable/,
        );
        assert.notEqual(stopped.overall, 'fail');

        const missing = byId(await run('absent'), 'services');
        assert.equal(missing.status, 'warn');
        assert.match(missing.summary, /GroceryPOS-ProxyLan is not installed/);
        assert.deepEqual(missing.steps, GUIDANCE.lanProxyMissing);

        // #529: unreadable LAN settings (not elevated): an installed LAN
        // service still means LAN terminals are configured.
        const denied = async (lan) =>
            byId(
                await diagnose(
                    { dataRoot: root },
                    healthy({
                        serviceStates: async () => ({
                            ...states,
                            [LAN_SERVICE]: lan,
                        }),
                        readText: async (path) => {
                            if (path === paths.runtimeManifest)
                                throw Object.assign(new Error('EPERM'), {
                                    code: 'EPERM',
                                });
                            return (await import('node:fs/promises')).readFile(
                                path,
                                'utf8',
                            );
                        },
                    }),
                ),
                'services',
            );
        const deniedStopped = await denied('STOPPED');
        assert.equal(deniedStopped.status, 'warn');
        assert.match(
            deniedStopped.summary,
            new RegExp(`${total - 1} of ${total}`),
        );
        assert.equal(
            (await denied('RUNNING')).summary,
            `All ${total} services are running.`,
        );
        assert.equal(
            (await denied('absent')).summary,
            `All ${total - 1} services are running.`,
        );

        const up = byId(await run('RUNNING'), 'services');
        assert.equal(up.status, 'ok');
        assert.equal(up.summary, `All ${total} services are running.`);
    });

    test('LAN network: address, profile, firewall rule and certificate (#399)', async () => {
        const paths = layout(root);
        const rootPem =
            '-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n';
        const lanCtx = (overrides = {}, manifest = { lanIp: '192.168.1.10' }) =>
            healthy({
                readText: async (path) => {
                    if (path === paths.runtimeManifest)
                        return JSON.stringify(manifest);
                    if (path.endsWith('root.crt')) return rootPem;
                    return (await import('node:fs/promises')).readFile(
                        path,
                        'utf8',
                    );
                },
                lanAddress: async () => ({
                    lanIpPresent: true,
                    lanProfile: 'Private',
                }),
                firewallRule: async () => 'enabled',
                tlsHandshake: async (host, port, ca) => {
                    assert.equal(host, '192.168.1.10');
                    assert.equal(port, 1443);
                    assert.equal(ca, rootPem);
                    return {};
                },
                ...overrides,
            });
        const run = async (ctx) =>
            byId(await diagnose({ dataRoot: root }, ctx), 'lanNetwork');
        const ok = await run(lanCtx());
        assert.equal(ok.status, 'ok');
        assert.equal(ok.details.tls, 'verified');
        // DHCP drift: the address is gone; no handshake is tried.
        let shook = false;
        const gone = await run(
            lanCtx({
                lanAddress: async () => ({
                    lanIpPresent: false,
                    lanProfile: null,
                }),
                tlsHandshake: async () => ((shook = true), {}),
            }),
        );
        assert.equal(gone.status, 'warn');
        assert.equal(shook, false);
        assert.deepEqual(gone.steps, GUIDANCE.lanAddressGone);
        const pub = await run(
            lanCtx({
                lanAddress: async () => ({
                    lanIpPresent: true,
                    lanProfile: 'Public',
                }),
            }),
        );
        assert.equal(pub.status, 'warn');
        assert.deepEqual(pub.steps, GUIDANCE.lanPublic);
        for (const state of ['missing', 'disabled']) {
            const fw = await run(lanCtx({ firewallRule: async () => state }));
            assert.equal(fw.status, 'warn', state);
            assert.deepEqual(fw.steps, GUIDANCE.lanFirewall);
        }
        const cert = await run(
            lanCtx({
                tlsHandshake: async () => ({
                    error: 'ERR_TLS_CERT_ALTNAME_INVALID',
                }),
            }),
        );
        assert.equal(cert.status, 'warn');
        assert.deepEqual(cert.steps, GUIDANCE.lanCertificate);
        assert.match(cert.summary, /ALTNAME/);
        // #508: a stopped LAN proxy is named, not blamed on the certificate.
        const withLan = (state) => async () => ({
            ...Object.fromEntries(
                Object.values(SERVICES).map((n) => [n, 'RUNNING']),
            ),
            [LAN_SERVICE]: state,
        });
        const refused = async () => ({ error: 'ECONNREFUSED' });
        for (const [state, word] of [
            ['STOPPED', /GroceryPOS-ProxyLan\) is stopped/],
            ['absent', /GroceryPOS-ProxyLan\) is not installed/],
            ['START_PENDING', /is not running \(START_PENDING\)/],
            ['RUNNING', /GroceryPOS-ProxyLan\) is not answering/],
            [undefined, /GroceryPOS-ProxyLan\) is not answering/],
        ]) {
            const down = await run(
                lanCtx({
                    serviceStates: withLan(state),
                    tlsHandshake: refused,
                }),
            );
            assert.equal(down.status, 'warn', String(state));
            assert.match(down.summary, word);
            assert.doesNotMatch(down.summary, /certificate/);
            assert.deepEqual(
                down.steps,
                state === 'absent'
                    ? GUIDANCE.lanProxyMissing
                    : state === 'STOPPED'
                      ? GUIDANCE.lanServiceStopped
                      : GUIDANCE.lanProxy,
            );
        }
        // A stopped service with another handshake error is still the service.
        const stoppedTimeout = await run(
            lanCtx({
                serviceStates: withLan('STOPPED'),
                tlsHandshake: async () => ({ error: 'TIMEOUT' }),
            }),
        );
        assert.match(stoppedTimeout.summary, /is stopped/);
        // A running service with a real certificate error stays a certificate.
        const badCert = await run(
            lanCtx({
                serviceStates: withLan('RUNNING'),
                tlsHandshake: async () => ({
                    error: 'ERR_TLS_CERT_ALTNAME_INVALID',
                }),
            }),
        );
        assert.deepEqual(badCert.steps, GUIDANCE.lanCertificate);
        // Problems add up.
        const both = await run(
            lanCtx({
                firewallRule: async () => 'missing',
                lanAddress: async () => ({
                    lanIpPresent: true,
                    lanProfile: 'Public',
                }),
            }),
        );
        assert.deepEqual(both.steps, [
            ...GUIDANCE.lanPublic,
            ...GUIDANCE.lanFirewall,
        ]);
        // Off Windows (facts unread) it is unknown, never ok.
        const unread = await run(
            lanCtx({
                lanAddress: async () => null,
                firewallRule: async () => null,
            }),
        );
        assert.equal(unread.status, 'unknown');
        // A present address whose network category can't be read is unknown.
        for (const lanProfile of ['unknown', null]) {
            const blank = await run(
                lanCtx({
                    lanAddress: async () => ({
                        lanIpPresent: true,
                        lanProfile,
                    }),
                }),
            );
            assert.equal(blank.status, 'unknown', String(lanProfile));
        }
        // Without LAN terminals it is informational and reads nothing.
        const none = await run(
            lanCtx(
                { lanAddress: async () => assert.fail('read without LAN') },
                {},
            ),
        );
        assert.equal(none.status, 'info');
        // The support export's redaction removes the LAN IP from details.
        assert.equal(
            redact(JSON.stringify(ok.details)).includes('192.168'),
            false,
        );
    });

    test('time server for LAN terminals (#398)', async () => {
        const paths = layout(root);
        let asked = false;
        const ctxWith = (facts, manifest = { lanIp: '192.168.1.10' }) =>
            healthy({
                readText: async (path) => {
                    if (path === paths.runtimeManifest)
                        return JSON.stringify(manifest);
                    return (await import('node:fs/promises')).readFile(
                        path,
                        'utf8',
                    );
                },
                timeServer: async () => {
                    asked = true;
                    return facts;
                },
            });
        const run = async (ctx) =>
            byId(await diagnose({ dataRoot: root }, ctx), 'timeServer');
        // No LAN IP: info, and nothing is read.
        const none = await run(ctxWith({ state: 'RUNNING' }, {}));
        assert.equal(none.status, 'info');
        assert.equal(asked, false);
        const ok = await run(
            ctxWith({ state: 'RUNNING', ntpServerEnabled: true }),
        );
        assert.equal(ok.status, 'ok');
        for (const facts of [
            { state: 'STOPPED', ntpServerEnabled: true },
            { state: 'PAUSED', ntpServerEnabled: true },
            { state: 'absent', ntpServerEnabled: true },
            { state: 'RUNNING', ntpServerEnabled: false },
            { state: null, ntpServerEnabled: false },
        ]) {
            const warn = await run(ctxWith(facts));
            assert.equal(warn.status, 'warn', JSON.stringify(facts));
            assert.deepEqual(warn.steps, GUIDANCE.timeServer);
        }
        for (const facts of [
            null,
            { state: 'RUNNING', ntpServerEnabled: null },
            { state: 'UNKNOWN', ntpServerEnabled: true },
            { state: 'START_PENDING', ntpServerEnabled: true },
            { state: 'STOP_PENDING', ntpServerEnabled: true },
            { state: null, ntpServerEnabled: true },
        ]) {
            const unknown = await run(ctxWith(facts));
            assert.equal(unknown.status, 'unknown', JSON.stringify(facts));
        }
    });

    test('time server fact parser (#398)', () => {
        const t = (stdout) => parseTimeServer(stdout);
        assert.deepEqual(t('svc=Running\r\nntp=1\r\n'), {
            state: 'RUNNING',
            ntpServerEnabled: true,
        });
        assert.deepEqual(t('svc=Stopped\nntp=0'), {
            state: 'STOPPED',
            ntpServerEnabled: false,
        });
        // Not found is absent; access denied or any other error is unknown.
        assert.equal(t('svc=notfound\nntp=1').state, 'absent');
        assert.equal(t('svc=error\nntp=1').state, null);
        assert.equal(t('svc=StartPending').state, 'START_PENDING');
        assert.equal(t('svc=Weird').state, 'UNKNOWN');
        assert.equal(t('svc=absent').state, 'UNKNOWN');
        assert.equal(t('ntp=error').ntpServerEnabled, null);
        assert.equal(t('ntp=').ntpServerEnabled, null);
        assert.deepEqual(t(''), { state: null, ntpServerEnabled: null });
        assert.deepEqual(t(undefined), { state: null, ntpServerEnabled: null });
    });

    test('LAN network fact parsers (#399)', () => {
        // #501: a removed rule is missing, a refused read is unknown.
        assert.equal(parseFirewallProbe(0, 'NotFound\r\n'), 'missing');
        assert.equal(parseFirewallProbe(0, 'True\r\n'), 'enabled');
        assert.equal(parseFirewallProbe(0, 'False'), 'disabled');
        assert.equal(parseFirewallProbe(2, ''), null);
        assert.equal(parseFirewallProbe(1, ''), null);
        assert.equal(parseFirewallProbe(0, ''), null);
        assert.equal(parseFirewallProbe(0, 'garbage'), null);
        const script = firewallProbeScript();
        assert.match(
            script,
            /-DisplayName 'GroceryPOS-LAN-HTTPS' -ErrorAction Stop/,
        );
        assert.match(
            script,
            /'ObjectNotFound'\) \{ 'NotFound' \} else \{ exit 2 \}/,
        );
        assert.doesNotMatch(script, /SilentlyContinue/);
        assert.deepEqual(parseLanAddress(''), {
            lanIpPresent: false,
            lanProfile: null,
        });
        assert.deepEqual(
            parseLanAddress('present|Private\r\npresent|Public\r\n'),
            {
                lanIpPresent: true,
                lanProfile: 'Public',
            },
        );
        assert.deepEqual(parseLanAddress('present|\r\n'), {
            lanIpPresent: true,
            lanProfile: 'unknown',
        });
    });

    test('the proxy may listen on the configured LAN IP only (#396)', async () => {
        const paths = layout(root);
        const running =
            (lanState = 'RUNNING') =>
            async () => ({
                ...Object.fromEntries(
                    Object.values(SERVICES).map((n) => [n, 'RUNNING']),
                ),
                [LAN_SERVICE]: lanState,
            });
        const withManifest = (manifest, listeners, lanState = 'RUNNING') =>
            healthy({
                serviceStates: running(lanState),
                readText: async (path) =>
                    path === paths.runtimeManifest
                        ? JSON.stringify(manifest)
                        : (await import('node:fs/promises')).readFile(
                              path,
                              'utf8',
                          ),
                listeners,
            });
        const lan = { lanIp: '192.168.1.10' };
        const ok = await diagnose(
            { dataRoot: root },
            withManifest(lan, async (p) =>
                p === 1443
                    ? ['127.0.0.1', '::1', '192.168.1.10']
                    : ['127.0.0.1'],
            ),
        );
        assert.equal(byId(ok, 'ports').status, 'ok');
        assert.equal(byId(ok, 'lanProxy').status, 'ok');
        // The LAN service stopped (address gone): terminals cannot connect,
        // a warning, not an app failure; this PC's checks stay ok.
        const down = await diagnose(
            { dataRoot: root },
            withManifest(
                lan,
                async (p) =>
                    p === 1443 ? ['127.0.0.1', '::1'] : ['127.0.0.1'],
                'STOPPED',
            ),
        );
        assert.equal(byId(down, 'lanProxy').status, 'warn');
        assert.deepEqual(
            byId(down, 'lanProxy').steps,
            GUIDANCE.lanServiceStopped,
        );
        for (const id of ['ports', 'api'])
            assert.equal(byId(down, id).status, 'ok', id);
        // #529: Services counts the configured LAN proxy, as a warning.
        assert.equal(byId(down, 'services').status, 'warn');
        // Running but not listening on the IP is the same warning.
        const deaf = await diagnose(
            { dataRoot: root },
            withManifest(lan, async () => ['127.0.0.1', '::1']),
        );
        assert.equal(byId(deaf, 'lanProxy').status, 'warn');
        const missing = await diagnose(
            { dataRoot: root },
            withManifest(lan, async () => ['127.0.0.1', '::1'], 'absent'),
        );
        assert.equal(byId(missing, 'lanProxy').status, 'fail');
        assert.deepEqual(
            byId(missing, 'lanProxy').steps,
            GUIDANCE.lanProxyMissing,
        );
        // Without LAN terminals the check is informational.
        const none = await diagnose(
            { dataRoot: root },
            withManifest({}, async (p) =>
                p === 1443 ? ['127.0.0.1', '::1'] : ['127.0.0.1'],
            ),
        );
        assert.equal(byId(none, 'lanProxy').status, 'info');
        assert.match(byId(ok, 'ports').summary, /192\.168\.1\.10/);
        const fails = [
            // Another LAN address, or a wildcard, for the proxy.
            [
                lan,
                async (p) =>
                    p === 1443 ? ['127.0.0.1', '192.168.1.11'] : ['127.0.0.1'],
            ],
            [
                lan,
                async (p) =>
                    p === 1443 ? ['127.0.0.1', '0.0.0.0'] : ['127.0.0.1'],
            ],
            [
                lan,
                async (p) => (p === 1443 ? ['127.0.0.1', '::'] : ['127.0.0.1']),
            ],
            // The API or MongoDB on the LAN IP.
            [
                lan,
                async (p) =>
                    p === 1443 ? ['127.0.0.1'] : ['127.0.0.1', '192.168.1.10'],
            ],
            // A configured address that is not private never counts.
            [
                { lanIp: '8.8.8.8' },
                async (p) =>
                    p === 1443 ? ['127.0.0.1', '8.8.8.8'] : ['127.0.0.1'],
            ],
            // No LAN IP configured.
            [
                {},
                async (p) =>
                    p === 1443 ? ['127.0.0.1', '192.168.1.10'] : ['127.0.0.1'],
            ],
        ];
        // A listener on the LAN IP while the LAN service is not running is
        // not ours.
        fails.push([
            lan,
            async (p) =>
                p === 1443 ? ['127.0.0.1', '192.168.1.10'] : ['127.0.0.1'],
            'STOPPED',
        ]);
        for (const [manifest, listeners, lanState] of fails) {
            const report = await diagnose(
                { dataRoot: root },
                withManifest(manifest, listeners, lanState),
            );
            assert.equal(byId(report, 'ports').status, 'fail');
            assert.deepEqual(byId(report, 'ports').steps, GUIDANCE.exposed);
        }
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

    test('EPERM and EACCES are access denied, directly or as cause (#456)', () => {
        for (const code of ['EACCES', 'EPERM']) {
            assert.equal(isAccessDenied({ code }), true);
            assert.equal(isAccessDenied({ cause: { code } }), true);
        }
        for (const e of [{ code: 'ENOENT' }, new SyntaxError('x'), null])
            assert.equal(isAccessDenied(e), false);
    });

    for (const code of ['EACCES', 'EPERM'])
        test(`${code} on the install record is unverified (#456)`, async () => {
            const report = await diagnose(
                { dataRoot: root, release },
                healthy({
                    readText: async (path) => {
                        if (path.endsWith('installer.json'))
                            throw Object.assign(new Error(code), { code });
                        return readFile(path, 'utf8');
                    },
                }),
            );
            const versions = byId(report, 'versions');
            assert.equal(versions.status, 'unknown');
            assert.deepEqual(versions.steps, []);
            // The release passed in is still read.
            assert.equal(versions.details.appVersion, '0.0.1');
            assert.equal(versions.details.installedVersion, null);
        });

    test('access denied is unverified, never a repair (#456)', async () => {
        const denied = (path) =>
            Object.assign(new Error(`EACCES: ${path}`), { code: 'EACCES' });
        const report = await diagnose(
            { dataRoot: root },
            healthy({
                readText: async (path) => {
                    if (path.endsWith('installer.json')) throw denied(path);
                    const { readFile } = await import('node:fs/promises');
                    return readFile(path, 'utf8');
                },
            }),
        );
        const versions = byId(report, 'versions');
        assert.equal(versions.status, 'unknown');
        assert.match(versions.summary, /unverified \(run as administrator\)/);
        assert.deepEqual(versions.steps ?? [], []);

        if (process.platform !== 'win32' && process.getuid?.() !== 0) {
            const { chmod } = await import('node:fs/promises');
            const status = layout(root).backupStatus;
            await writeStatus({ lastExport: { at: hoursAgo(1) } });
            await chmod(status, 0o000);
            try {
                const backups = byId(
                    await diagnose({ dataRoot: root }, healthy()),
                    'backups',
                );
                assert.equal(backups.status, 'unknown');
                assert.match(
                    backups.summary,
                    /unverified \(run as administrator\)/,
                );
                assert.deepEqual(backups.steps ?? [], []);
            } finally {
                await chmod(status, 0o600);
            }
        }
    });

    const ADMIN_FOOTER =
        'Some checks need administrator rights; run as administrator for a full check.';
    const ATTENTION_FOOTER =
        'Something needs attention: follow the steps above.';
    const healthyBackups = () =>
        writeStatus({
            lastAttempt: { at: hoursAgo(5) },
            lastSuccess: { at: hoursAgo(5) },
            lastVerifiedSuccess: { at: hoursAgo(5), backupId: 'b1' },
            lastExport: { at: hoursAgo(24) },
        });
    const deniedInstallRecord = (extra = {}) =>
        healthy({
            readText: async (path) => {
                if (path.endsWith('installer.json'))
                    throw Object.assign(new Error('EACCES'), {
                        code: 'EACCES',
                    });
                return readFile(path, 'utf8');
            },
            ...extra,
        });

    test('only admin-unverified checks: admin footer, exit 3 (#456)', async () => {
        await healthyBackups();
        const report = await diagnose(
            { dataRoot: root },
            deniedInstallRecord(),
        );
        assert.equal(report.overall, 'unknown');
        assert.ok(onlyAdminUnverified(report));
        const text = renderText(report);
        assert.ok(text.includes(ADMIN_FOOTER));
        assert.ok(!text.includes(ATTENTION_FOOTER));
        assert.equal(checkExitCode(report), EXIT.UNVERIFIED);
        assert.equal(EXIT.UNVERIFIED, 3);
        // The marker never reaches the JSON.
        assert.deepEqual(Object.keys(report), [...REPORT_KEYS]);
        assert.ok(!JSON.stringify(report).includes('dmin_'));
    });

    test('a non-admin unknown alone is attention, exit 1 (#456)', async () => {
        await healthyBackups();
        const report = await diagnose(
            { dataRoot: root },
            healthy({ clockSync: async () => null }),
        );
        assert.equal(byId(report, 'clockSync').status, 'unknown');
        assert.equal(report.overall, 'unknown');
        const text = renderText(report);
        assert.ok(text.includes(ATTENTION_FOOTER));
        assert.ok(!text.includes(ADMIN_FOOTER));
        assert.equal(checkExitCode(report), EXIT.ATTENTION);
    });

    test('admin unknown plus another unknown is attention, exit 1 (#456)', async () => {
        await healthyBackups();
        const report = await diagnose(
            { dataRoot: root },
            deniedInstallRecord({ clockSync: async () => null }),
        );
        assert.equal(byId(report, 'versions').status, 'unknown');
        assert.ok(renderText(report).includes(ATTENTION_FOOTER));
        assert.equal(checkExitCode(report), EXIT.ATTENTION);
    });

    test('clockSync with an unreadable time source is admin-unverified, exit 3 (#481)', async () => {
        await healthyBackups();
        const report = await diagnose(
            { dataRoot: root },
            healthy({
                clockSync: async () => ({
                    state: 'RUNNING',
                    startType: 'Manual',
                    syncType: 'NTP',
                    source: null,
                    sourceDenied: true,
                }),
            }),
        );
        assert.equal(byId(report, 'clockSync').status, 'unknown');
        assert.ok(onlyAdminUnverified(report));
        assert.equal(checkExitCode(report), EXIT.UNVERIFIED);
    });

    test('clockSync with a source unreadable for another reason: exit 1 (#481)', async () => {
        await healthyBackups();
        const report = await diagnose(
            { dataRoot: root },
            healthy({
                clockSync: async () => ({
                    state: 'RUNNING',
                    startType: 'Manual',
                    syncType: 'NTP',
                    source: null,
                }),
            }),
        );
        assert.equal(byId(report, 'clockSync').status, 'unknown');
        assert.ok(!onlyAdminUnverified(report));
        assert.equal(checkExitCode(report), EXIT.ATTENTION);
    });

    test('proxy probe without the root alone: exit 3; all ok: exit 0 (#456)', async () => {
        await healthyBackups();
        const report = await diagnose({ dataRoot: root }, healthy());
        assert.equal(byId(report, 'proxy').status, 'unknown');
        assert.equal(checkExitCode(report), EXIT.UNVERIFIED);
        for (const c of report.checks) c.status = 'ok';
        assert.equal(checkExitCode({ ...report, overall: 'ok' }), EXIT.OK);
    });

    test('clockSync: Set time automatically off names the setting (#456)', async () => {
        const check = byId(
            await diagnose(
                { dataRoot: root },
                healthy({
                    clockSync: async () => ({
                        state: 'STOPPED',
                        startType: 'Disabled',
                        syncType: 'NoSync',
                        source: null,
                    }),
                }),
            ),
            'clockSync',
        );
        assert.equal(check.status, 'warn');
        assert.match(check.summary, /^Set time automatically is off/);
        assert.doesNotMatch(GUIDANCE.clockSync.join(' '), /sync, \(/);
    });

    test('clockSync: trigger-start, NoSync, disabled, localized, Hyper-V, unreadable (#446)', async () => {
        const run = async (facts) =>
            byId(
                await diagnose(
                    { dataRoot: root },
                    healthy({ clockSync: async () => facts }),
                ),
                'clockSync',
            );
        const base = {
            state: 'RUNNING',
            startType: 'Manual',
            syncType: 'NTP',
            source: 'time.windows.com,0x9',
        };
        const ok = [
            base,
            // A stopped trigger-start service is normal on a workgroup PC.
            {
                state: 'STOPPED',
                startType: 'Manual',
                syncType: 'NTP',
                source: null,
            },
            { ...base, syncType: 'NT5DS', source: 'dc01.store.local' },
            { ...base, syncType: 'AllSync' },
            { ...base, source: 'VM IC Time Synchronization Provider' },
        ];
        for (const facts of ok)
            assert.equal(
                (await run(facts)).status,
                'ok',
                JSON.stringify(facts),
            );
        const warns = [
            { ...base, syncType: 'NoSync' },
            { ...base, state: 'STOPPED', startType: 'Disabled', source: null },
            { state: 'absent', startType: null, syncType: null, source: null },
        ];
        for (const facts of warns) {
            const warn = await run(facts);
            assert.equal(warn.status, 'warn', JSON.stringify(facts));
            assert.deepEqual(warn.steps, GUIDANCE.clockSync);
            assert.match(
                warn.steps.join(' '),
                /Turn on Set time automatically/,
            );
        }
        // #508: a running service on a local source (no internet yet, the
        // first minutes after a trigger start, or the LAN time server with
        // /reliable:yes) is info, never a warning: a stopped service is ok.
        for (const source of [
            'Local CMOS Clock',
            'Horloge CMOS locale',
            'Free-running System Clock',
        ]) {
            const local = await run({ ...base, source });
            assert.equal(local.status, 'info', source);
            assert.match(local.summary, /^Set time automatically is on/);
            assert.ok(local.summary.includes(source));
            assert.deepEqual(local.steps, []);
        }
        // Any other running type on a local source is not syncing (#508).
        for (const syncType of ['NT5DS', 'Weird'])
            for (const source of [
                'Local CMOS Clock',
                'Free-running System Clock',
            ]) {
                const w = await run({ ...base, syncType, source });
                assert.equal(w.status, 'warn', `${syncType} ${source}`);
                assert.deepEqual(w.steps, GUIDANCE.clockSync);
            }
        assert.equal(
            (
                await run({
                    ...base,
                    syncType: 'AllSync',
                    source: 'Local CMOS Clock',
                })
            ).status,
            'info',
        );
        for (const facts of [
            null,
            { ...base, state: null },
            { ...base, startType: null },
            { ...base, syncType: null },
            // #481: unreadable settings stay a real fault, even denied.
            { ...base, syncType: null, source: null },
            { ...base, syncType: null, source: null, sourceDenied: true },
        ])
            assert.equal(
                (await run(facts)).status,
                'unknown',
                JSON.stringify(facts),
            );
        // #481: a running service whose source is unreadable (no admin) is
        // unverified, not ok and not a warning.
        const denied = await run({ ...base, source: null, sourceDenied: true });
        assert.equal(denied.status, 'unknown');
        assert.match(denied.summary, /unverified \(run as administrator\)/);
        // Any other unreadable source is a plain unknown, not admin-only.
        const unread = await run({ ...base, source: null });
        assert.equal(unread.status, 'unknown');
        assert.doesNotMatch(unread.summary, /run as administrator/);
    });

    test('parseClockSync', () => {
        assert.deepEqual(
            parseClockSync(
                'svc=Running\r\nstart=Manual\r\ntype=NTP\r\nsync=time.windows.com,0x9\r\n',
            ),
            {
                state: 'RUNNING',
                startType: 'Manual',
                syncType: 'NTP',
                source: 'time.windows.com,0x9',
            },
        );
        assert.deepEqual(
            parseClockSync(
                'svc=Stopped\nstart=Disabled\ntype=error\nsync=error',
            ),
            {
                state: 'STOPPED',
                startType: 'Disabled',
                syncType: null,
                source: null,
            },
        );
        assert.deepEqual(
            parseClockSync('svc=notfound\ntype=NoSync\nsync=error'),
            {
                state: 'absent',
                startType: null,
                syncType: 'NoSync',
                source: null,
            },
        );
        assert.deepEqual(
            parseClockSync('svc=Running\nstart=Manual\ntype=NTP\nsync=denied'),
            {
                sourceDenied: true,
                state: 'RUNNING',
                startType: 'Manual',
                syncType: 'NTP',
                source: null,
            },
        );
        assert.deepEqual(parseClockSync(''), {
            state: null,
            startType: null,
            syncType: null,
            source: null,
        });
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
        const ids = [
            'versions',
            'services',
            'ports',
            'database',
            'api',
            'proxy',
            'lanProxy',
            'lanNetwork',
            'timeServer',
            'clockSync',
            'disk',
            'backups',
            'clock',
            'logs',
        ];
        assert.deepEqual([...CHECK_IDS], ids);
        assert.deepEqual(
            report.checks.map((c) => c.id),
            ids,
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
                'proxyLan',
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

test('single-PC docs stop the API with -Force and restart the proxies (#457)', () => {
    const docs = [
        'diagnostics/RECOVERY.md',
        'acceptance/RUNBOOK.md',
        'operations/REPLACEMENT-PC.md',
        'installer/README.md',
        'runtime/README.md',
        'upgrade/README.md',
        'backup/README.md',
    ];
    for (const doc of docs) {
        const text = readFileSync(
            new URL(`../${doc}`, import.meta.url),
            'utf8',
        );
        const inline = text.replace(/\s+/g, ' ');
        // A lone `Stop-Service GroceryPOS-API` fails: the proxy depends on it.
        assert.doesNotMatch(
            inline,
            /Stop-Service (?:-Name )?GroceryPOS-API(?! -Force)(?!-)/,
            `${doc} stops the API without -Force`,
        );
    }
    const recovery = readFileSync(
        new URL('../diagnostics/RECOVERY.md', import.meta.url),
        'utf8',
    ).replace(/\s+/g, ' ');
    assert.match(recovery, /Stop-Service GroceryPOS-API -Force/);
    assert.match(recovery, /Start-Service GroceryPOS-API, GroceryPOS-Proxy/);
    assert.match(recovery, /GroceryPOS-ProxyLan/);
    assert.match(
        recovery,
        /diagnose\.mjs" \^ check --data-root \S+ \^ --release /,
    );
});

describe('support export IP redaction (#500)', () => {
    const listed = [
        '192.168.1.8',
        '10.0.0.7',
        '172.20.0.1',
        '100.64.1.2',
        '169.254.3.4',
        '8.8.8.8',
        'fe80::1%12',
        'fd00::5',
        '2001:db8::7',
        '::ffff:10.0.0.9',
        '::ffff:c0a8:0109',
    ];

    test('the export keeps no IP but loopback and unspecified', async () => {
        const out = await mkdtemp(join(tmpdir(), 'gpos-usb-'));
        try {
            const file = await supportExport(
                { dataRoot: root, to: out },
                healthy({
                    readText: async (path) =>
                        path === layout(root).runtimeManifest
                            ? JSON.stringify({ lanIp: '192.168.1.8' })
                            : readFile(path, 'utf8'),
                    serviceStates: async () => ({
                        ...Object.fromEntries(
                            Object.values(SERVICES).map((n) => [n, 'RUNNING']),
                        ),
                        [LAN_SERVICE]: 'RUNNING',
                    }),
                    listeners: async () => ['127.0.0.1', '::1', ...listed],
                }),
            );
            const text = await readFile(file, 'utf8');
            for (const ip of listed) assert.ok(!text.includes(ip), ip);
        } finally {
            await rm(out, { recursive: true, force: true });
        }
    });

    test('scrubIps removes a private IPv4 ending a sentence in any field (#530)', () => {
        const lan = '192.168.1.8';
        const report = {
            checks: [
                {
                    id: 'ports',
                    status: 'ok',
                    summary: `Listening on loopback, and the LAN terminals' service also on ${lan}.`,
                    steps: [
                        `Check ${lan}.`,
                        `(${lan}), 10.0.0.5; 172.16.4.2: 169.254.9.9!`,
                    ],
                    details: {
                        listeners: [{ address: `${lan}:1443` }],
                        note: `ip ${lan}.`,
                    },
                },
                {
                    id: 'lanNetwork',
                    details: { lanIp: lan, nested: [[`at ${lan}.`]] },
                },
            ],
            version: '1.2.3.4.5',
            kept: 'API on 127.0.0.1.',
        };
        const out = JSON.stringify(scrubIps(report));
        for (const ip of [lan, '10.0.0.5', '172.16.4.2', '169.254.9.9'])
            assert.ok(!out.includes(ip), ip);
        assert.ok(!/\b(?:10|172|192|169)\.\d+\.\d+\.\d+/.test(out), out);
        assert.ok(out.includes('also on [ip].'));
        assert.ok(out.includes('1.2.3.4.5'));
        assert.ok(out.includes('API on 127.0.0.1.'));
    });

    test('scrubIps replaces every address but loopback and unspecified', () => {
        const kept = ['127.0.0.1', '127.5.5.5', '::1', '0.0.0.0', '::'];
        const value = {
            summary: `on ${listed.join(' and ')} at 12:30:45`,
            lanIp: '192.168.1.8',
            list: [...listed, ...kept, 7, null],
        };
        assert.deepEqual(scrubIps(value), {
            summary: `on ${listed.map(() => '[ip]').join(' and ')} at 12:30:45`,
            lanIp: '[ip]',
            list: [...listed.map(() => '[ip]'), ...kept, 7, null],
        });
    });
});
