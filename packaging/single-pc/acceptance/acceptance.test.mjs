// Portable tests of the acceptance harness and readiness checker (#366).
// Windows command output is recorded, not real: nothing here proves the
// harness on Windows.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, cp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
    EXIT,
    MANUAL,
    UPGRADE_WINDOW_MS,
    evaluateDiagnostics,
    evaluateHandoverAcl,
    evaluateListeners,
    evaluateServices,
    evaluateUpgradeJournal,
    evidence,
    jsonList,
    main,
    parseArgs,
    redact,
    runChecks,
} from './acceptance.mjs';
import * as readiness from './readiness.mjs';

const GOOD_SERVICES = [
    {
        Name: 'GroceryPOS-MongoDB',
        State: 'Running',
        StartMode: 'Auto',
        StartName: 'NT SERVICE\\GroceryPOS-MongoDB',
        DependsOn: [],
    },
    {
        Name: 'GroceryPOS-API',
        State: 'Running',
        StartMode: 'Auto',
        StartName: 'NT SERVICE\\GroceryPOS-API',
        DependsOn: 'GroceryPOS-MongoDB',
    },
    {
        Name: 'GroceryPOS-Proxy',
        State: 'Running',
        StartMode: 'Auto',
        StartName: 'NT SERVICE\\GroceryPOS-Proxy',
        DependsOn: ['GroceryPOS-API'],
    },
];
const GOOD_LISTENERS = [
    { LocalAddress: '127.0.0.1', LocalPort: 27018 },
    { LocalAddress: '127.0.0.1', LocalPort: 13000 },
    { LocalAddress: '127.0.0.1', LocalPort: 1443 },
    { LocalAddress: '::1', LocalPort: 1443 },
];
const HANDOVER_ACL = `C:\\ProgramData\\Valorthon\\GroceryPOS-Handover NT AUTHORITY\\SYSTEM:(OI)(CI)(F)
                                            BUILTIN\\Administrators:(OI)(CI)(F)

Successfully processed 1 files; Failed processing 0 files`;

test('redact removes credentials and keeps SHA-256 digests', () => {
    const digest = 'a'.repeat(64);
    const text = redact(
        `mongodb://gpos_api:hunter2@127.0.0.1:27018/grocery password=abc JWT_SECRET="xyz" eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlc2lnbmF0dXJl ${'Ab3_x'.repeat(10)} C:\\ProgramData\\Valorthon\\GroceryPOS\\secrets ${digest}`,
    );
    assert.doesNotMatch(text, /hunter2|abc|xyz|Ab3_x|eyJhbGci/);
    assert.match(text, /GroceryPOS/);
    assert.match(text, new RegExp(digest));
});

test('jsonList accepts one object, an array or nothing (PS 5.1 unrolling)', () => {
    assert.deepEqual(jsonList(''), []);
    assert.deepEqual(jsonList('{"a":1}'), [{ a: 1 }]);
    assert.deepEqual(jsonList('[{"a":1},{"a":2}]'), [{ a: 1 }, { a: 2 }]);
});

test('listeners: loopback only and every port present', () => {
    assert.equal(evaluateListeners(GOOD_LISTENERS).status, 'pass');
    const exposed = evaluateListeners([
        ...GOOD_LISTENERS,
        { LocalAddress: '0.0.0.0', LocalPort: 13000 },
    ]);
    assert.equal(exposed.status, 'fail');
    assert.deepEqual(exposed.exposed, ['0.0.0.0:13000']);
    const missing = evaluateListeners(GOOD_LISTENERS.slice(1));
    assert.deepEqual(missing.missing, [27018]);
});

test('listeners: Caddy on the configured LAN IP only while GroceryPOS-ProxyLan owns it (#396)', () => {
    const lan = { LocalAddress: '192.168.1.10', LocalPort: 1443 };
    const rows = [...GOOD_LISTENERS, lan];
    const lanIp = '192.168.1.10';
    for (const lanService of ['Running', 'StartPending'])
        assert.equal(
            evaluateListeners(rows, { lanIp, lanService }).status,
            'pass',
            lanService,
        );
    for (const lanService of ['Stopped', 'absent', undefined, null])
        assert.deepEqual(
            evaluateListeners(rows, { lanIp, lanService }).exposed,
            ['192.168.1.10:1443'],
            String(lanService),
        );
    // Without a configured LAN IP, or on another address or port.
    assert.equal(evaluateListeners(rows).status, 'fail');
    assert.deepEqual(
        evaluateListeners(
            [
                ...GOOD_LISTENERS,
                { LocalAddress: '192.168.1.11', LocalPort: 1443 },
                { LocalAddress: '192.168.1.10', LocalPort: 13000 },
                { LocalAddress: '192.168.1.10', LocalPort: 27018 },
            ],
            { lanIp, lanService: 'Running' },
        ).exposed,
        ['192.168.1.11:1443', '192.168.1.10:13000', '192.168.1.10:27018'],
    );
    // The LAN listener never stands in for the loopback one.
    const noLoopback = evaluateListeners([...GOOD_LISTENERS.slice(0, 2), lan], {
        lanIp,
        lanService: 'Running',
    });
    assert.deepEqual(noLoopback.missing, [1443]);
});

test('runChecks listeners reads the LAN IP and the LAN service state', async () => {
    const runtime = join(
        'C:\\ProgramData\\Valorthon\\GroceryPOS',
        'config',
        'runtime.json',
    );
    const make = (state) =>
        fakeContext({
            files: { [runtime]: JSON.stringify({ lanIp: '192.168.1.10' }) },
            run: (cmd, joined) => {
                if (joined.includes('Get-NetTCPConnection'))
                    return {
                        code: 0,
                        stdout: JSON.stringify([
                            ...GOOD_LISTENERS,
                            { LocalAddress: '192.168.1.10', LocalPort: 1443 },
                        ]),
                        stderr: '',
                    };
                if (joined.includes('GroceryPOS-ProxyLan'))
                    return { code: 0, stdout: `${state}\r\n`, stderr: '' };
            },
        });
    const listeners = async (state) =>
        (
            await runChecks(make(state), {
                dataRoot: 'C:\\ProgramData\\Valorthon\\GroceryPOS',
            })
        ).find((r) => r.id === 'listeners');
    const running = await listeners('Running');
    assert.equal(running.status, 'pass', JSON.stringify(running));
    assert.equal(running.lanService, 'Running');
    assert.equal((await listeners('Stopped')).status, 'fail');
});

test('runChecks listeners refuses a LAN listener without a private configured lanIp', async () => {
    const root = 'C:\\ProgramData\\Valorthon\\GroceryPOS';
    const runtime = join(root, 'config', 'runtime.json');
    for (const manifest of [{ lanIp: '8.8.8.8' }, {}]) {
        const calls = [];
        const ctx = fakeContext({
            files: { [runtime]: JSON.stringify(manifest) },
            run: (cmd, joined) => {
                calls.push(joined);
                if (joined.includes('Get-NetTCPConnection'))
                    return {
                        code: 0,
                        stdout: JSON.stringify([
                            ...GOOD_LISTENERS,
                            { LocalAddress: '8.8.8.8', LocalPort: 1443 },
                        ]),
                        stderr: '',
                    };
                if (joined.includes('GroceryPOS-ProxyLan'))
                    return { code: 0, stdout: 'Running', stderr: '' };
            },
        });
        const r = (await runChecks(ctx, { dataRoot: root })).find(
            (x) => x.id === 'listeners',
        );
        assert.equal(r.status, 'fail', JSON.stringify(manifest));
        assert.equal(r.lanIp, null);
        assert.deepEqual(r.exposed, ['8.8.8.8:1443']);
        // No LAN service query without a usable LAN IP.
        assert.ok(!calls.some((c) => c.includes('GroceryPOS-ProxyLan')));
    }
});

test('services: running, automatic, virtual account, dependency order', () => {
    assert.equal(evaluateServices(GOOD_SERVICES).status, 'pass');
    const bad = evaluateServices([
        { ...GOOD_SERVICES[0], StartName: 'LocalSystem' },
        { ...GOOD_SERVICES[1], StartMode: 'Manual', DependsOn: [] },
    ]);
    assert.equal(bad.status, 'fail');
    assert.deepEqual(bad.problems, [
        'GroceryPOS-MongoDB: runs as LocalSystem',
        'GroceryPOS-API: start mode Manual',
        'GroceryPOS-API: does not depend on GroceryPOS-MongoDB',
        'GroceryPOS-Proxy: not registered',
    ]);
});

test('handover ACL uses well-known SIDs regardless of localized account names', () => {
    const rules = [
        { Sid: 'S-1-5-18', Name: 'NT-AUTORITÄT\\SYSTEM', Inherited: false },
        {
            Sid: 'S-1-5-32-544',
            Name: 'BUILTIN\\Administratoren',
            Inherited: false,
        },
    ];
    assert.equal(evaluateHandoverAcl({ Rules: rules }).status, 'pass');
    const inherited = evaluateHandoverAcl({
        Rules: [...rules, { Sid: 'S-1-5-32-545', Inherited: true }],
    });
    assert.equal(inherited.status, 'fail');
    assert.equal(inherited.problems.length, 2);
    assert.equal(evaluateHandoverAcl({}).status, 'fail');
});

test('upgrade window: 30 minutes from the journal', () => {
    assert.equal(evaluateUpgradeJournal(undefined).status, 'manual');
    assert.equal(
        evaluateUpgradeJournal({ state: 'running', timings: {} }).status,
        'fail',
    );
    assert.equal(
        evaluateUpgradeJournal({
            state: 'complete',
            timings: { total: UPGRADE_WINDOW_MS },
        }).status,
        'pass',
    );
    const slow = evaluateUpgradeJournal({
        state: 'complete',
        timings: { total: UPGRADE_WINDOW_MS + 1 },
    });
    assert.equal(slow.status, 'fail');
    assert.equal(slow.totalMinutes, 30);
});

test('diagnostics: only overall ok passes', () => {
    assert.equal(
        evaluateDiagnostics({ overall: 'ok', checks: [] }).status,
        'pass',
    );
    const r = evaluateDiagnostics({
        overall: 'fail',
        checks: [
            { id: 'disk', status: 'fail' },
            { id: 'api', status: 'ok' },
        ],
    });
    assert.equal(r.status, 'fail');
    assert.deepEqual(r.failing, ['disk: fail']);
});

test('arguments are strict', () => {
    assert.throws(() => parseArgs([]), /--out/);
    assert.throws(() => parseArgs(['--out', 'x', '--bogus', '1']), /Unknown/);
    assert.throws(
        () => parseArgs(['--out', 'x', '--bundle', 'b']),
        /manifest-sha256/,
    );
    assert.throws(() => parseArgs(['--out', 'x', '--commit', 'abc']), /40 hex/);
    assert.equal(
        parseArgs(['--out', 'x', '--commit', 'a'.repeat(40)]).commit,
        'a'.repeat(40),
    );
});

/** A recording Windows context with canned command output. */
function fakeContext(overrides = {}) {
    const written = new Map();
    const calls = [];
    return {
        written,
        calls,
        platform: 'win32',
        env: { ProgramFiles: '/pf', ProgramData: '/pd', PUBLIC: '/pub' },
        now: () => new Date('2026-11-15T00:00:00Z'),
        execPath: '/release/node/node.exe',
        run(cmd, args) {
            calls.push([cmd, ...args]);
            const joined = args.join(' ');
            const out = (stdout, code = 0) => ({ code, stdout, stderr: '' });
            if (overrides.run) {
                const r = overrides.run(cmd, joined);
                if (r) return r;
            }
            if (joined.includes('Win32_OperatingSystem'))
                return out(
                    JSON.stringify({
                        Caption: 'Microsoft Windows 11 Pro',
                        BuildNumber: '26100',
                        ProductType: 1,
                        OSArchitecture: '64-bit',
                    }),
                );
            if (joined.includes('Win32_Processor'))
                return out(
                    JSON.stringify({
                        Name: 'Intel Core i5',
                        Manufacturer: 'GenuineIntel',
                        Architecture: 9,
                    }),
                );
            if (joined.includes('IsProcessorFeaturePresent'))
                return out('True\r\n');
            if (joined.includes('Get-PhysicalDisk'))
                return out(
                    JSON.stringify({ FriendlyName: 'SSD', MediaType: 'SSD' }),
                );
            if (joined.includes('Win32_Service'))
                return out(JSON.stringify(GOOD_SERVICES));
            if (joined.includes('Get-NetTCPConnection'))
                return out(JSON.stringify(GOOD_LISTENERS));
            if (joined.includes('Invoke-WebRequest')) return out('200\r\n');
            if (joined.includes('Get-Acl'))
                return out(
                    JSON.stringify({
                        Rules: [
                            { Sid: 'S-1-5-18', Inherited: false },
                            { Sid: 'S-1-5-32-544', Inherited: false },
                        ],
                    }),
                );
            if (cmd === 'icacls')
                return out(
                    HANDOVER_ACL.replace(
                        'C:\\ProgramData\\Valorthon\\GroceryPOS-Handover',
                        args[0],
                    ),
                );
            if (cmd === 'schtasks') return out('TaskName: x');
            if (joined.includes('Test-Path')) {
                const paths = [...joined.matchAll(/'([^']+\.lnk)'/g)].map(
                    (m) => m[1],
                );
                return out(
                    JSON.stringify(
                        paths.map((Path) => ({ Path, Exists: true })),
                    ),
                );
            }
            if (joined.includes('diagnose.mjs'))
                return out(
                    JSON.stringify({
                        overall: 'ok',
                        checks: [],
                        notObserved: [],
                    }),
                );
            if (joined.includes('backup.mjs'))
                return out(
                    JSON.stringify({
                        lastVerifiedSuccess: { at: '2026-11-14T14:00:00Z' },
                        backupOverdue: false,
                        password: 'nope',
                    }),
                );
            return out('', 1);
        },
        readFile: async (p) => {
            if (overrides.files?.[p] !== undefined)
                return Buffer.from(overrides.files[p]);
            throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        },
        writeNew: async (p, text) => {
            if (written.has(p))
                throw Object.assign(new Error('exists'), { code: 'EEXIST' });
            written.set(p, text);
        },
    };
}

test('runChecks against a healthy recorded installation', async () => {
    const ctx = fakeContext();
    const results = await runChecks(ctx, { release: '/release' });
    const byId = Object.fromEntries(results.map((r) => [r.id, r]));
    for (const id of [
        'platform',
        'services',
        'listeners',
        'trusted-origin',
        'acl-handover',
        'tasks',
        'shortcuts',
        'diagnostics',
        'backup-status',
    ]) {
        assert.equal(
            byId[id].status,
            'pass',
            `${id}: ${JSON.stringify(byId[id])}`,
        );
    }
    assert.equal(byId.bundle.status, 'manual');
    assert.equal(byId['acl-data'].status, 'manual');
    assert.equal(byId['upgrade-window'].status, 'manual');
    // Nothing that changes state is ever called.
    for (const call of ctx.calls) {
        assert.doesNotMatch(
            call.join(' '),
            /Stop-Service|Start-Service|sc(\.exe)? (stop|start|config|delete)|restore\.mjs|Install\.ps1|\/Run|\/Delete|\/Create/i,
        );
    }
});

test('runChecks reports refusals of ineligible targets and command failures', async () => {
    const ctx = fakeContext({
        run: (cmd, joined) => {
            if (joined.includes('Win32_OperatingSystem'))
                return {
                    code: 0,
                    stdout: JSON.stringify({
                        Caption: 'Microsoft Windows Server 2022 Standard',
                        BuildNumber: '20348',
                        ProductType: 3,
                        OSArchitecture: '64-bit',
                    }),
                    stderr: '',
                };
            if (joined.includes('Win32_Processor'))
                return {
                    code: 0,
                    stdout: JSON.stringify({
                        Manufacturer: 'Qualcomm',
                        Architecture: 12,
                    }),
                    stderr: '',
                };
            if (joined.includes('Win32_Service'))
                return {
                    code: 1,
                    stdout: '',
                    stderr: 'Access denied mongodb://u:p@h/x',
                };
            if (cmd === 'schtasks') return { code: 1, stdout: '', stderr: '' };
        },
    });
    const results = await runChecks(ctx, {});
    const byId = Object.fromEntries(results.map((r) => [r.id, r]));
    assert.equal(byId.platform.status, 'fail');
    // Server edition, ARM64 architecture, Qualcomm vendor.
    assert.equal(byId.platform.problems.length, 3);
    assert.equal(byId.services.status, 'error');
    assert.doesNotMatch(byId.services.note, /u:p/);
    assert.equal(byId.tasks.status, 'fail');
    assert.equal(byId.diagnostics.status, 'manual');
});

/** Platform result for one OS caption/build and AVX answer. */
async function platformFor({
    Caption,
    BuildNumber,
    ProductType = 1,
    avx = 'True\r\n',
    avxCode = 0,
}) {
    const ctx = fakeContext({
        run: (cmd, joined) => {
            if (joined.includes('Win32_OperatingSystem'))
                return {
                    code: 0,
                    stdout: JSON.stringify({
                        Caption,
                        BuildNumber,
                        ProductType,
                        OSArchitecture: '64-bit',
                    }),
                    stderr: '',
                };
            if (joined.includes('IsProcessorFeaturePresent'))
                return { code: avxCode, stdout: avx, stderr: '' };
        },
    });
    const results = await runChecks(ctx, {});
    return results.find((r) => r.id === 'platform');
}

test('platform accepts Windows 10 22H2 and Windows 11 and records AVX (#491)', async () => {
    const home = await platformFor({
        Caption: 'Microsoft Windows 10 Home',
        BuildNumber: '19045',
    });
    assert.equal(home.status, 'pass');
    assert.equal(home.windows10_22H2, true);
    assert.equal(home.avx, true);
    const eleven = await platformFor({
        Caption: 'Microsoft Windows 11 Pro',
        BuildNumber: '26100',
    });
    assert.equal(eleven.status, 'pass');
    assert.equal(eleven.windows10_22H2, null);
});

test('platform warns for Windows 10 before 22H2 and for unknown AVX', async () => {
    const old = await platformFor({
        Caption: 'Microsoft Windows 10 Pro',
        BuildNumber: '19044',
    });
    assert.equal(old.status, 'warn');
    assert.equal(old.windows10_22H2, false);
    assert.match(old.warnings[0], /not 22H2/);
    const unknown = await platformFor({
        Caption: 'Microsoft Windows 11 Pro',
        BuildNumber: '26100',
        avx: '',
        avxCode: 1,
    });
    assert.equal(unknown.status, 'warn');
    assert.equal(unknown.avx, null);
});

test('platform fails without AVX, on Server and on out-of-range builds', async () => {
    const noAvx = await platformFor({
        Caption: 'Microsoft Windows 10 Pro',
        BuildNumber: '19045',
        avx: 'False',
    });
    assert.equal(noAvx.status, 'fail');
    assert.deepEqual(noAvx.problems, ['CPU has no AVX']);
    for (const [Caption, BuildNumber] of [
        ['Microsoft Windows Server 2025 Datacenter', '26100'],
        ['Microsoft Windows 10 Pro', '10239'],
        ['Microsoft Windows 10 Pro', '19046'],
        ['Microsoft Windows 11 Pro', '21999'],
        ['Microsoft Windows 8.1 Pro', '9600'],
    ])
        assert.equal(
            (await platformFor({ Caption, BuildNumber })).status,
            'fail',
            `${Caption} ${BuildNumber}`,
        );
});

test('platform fails a server product type and records no 22H2 without a numeric build', async () => {
    const server = await platformFor({
        Caption: 'Microsoft Windows 10 Pro',
        BuildNumber: '19045',
        ProductType: 3,
    });
    assert.equal(server.status, 'fail');
    for (const BuildNumber of [undefined, '', 'abc']) {
        const r = await platformFor({
            Caption: 'Microsoft Windows 10 Pro',
            BuildNumber,
        });
        assert.equal(r.status, 'fail');
        assert.equal(r.windows10_22H2, null);
    }
});

test('upgrade journal read from the data root', async () => {
    const ctx = fakeContext({
        files: {
            [join('/data', 'state', 'upgrade.json')]: JSON.stringify({
                state: 'complete',
                timings: { total: 120000 },
            }),
        },
    });
    const results = await runChecks(ctx, { dataRoot: '/data' });
    const upgrade = results.find((r) => r.id === 'upgrade-window');
    assert.equal(upgrade.status, 'pass');
    assert.equal(upgrade.totalMinutes, 2);
});

test('main refuses off Windows and never writes evidence there', async () => {
    const ctx = { ...fakeContext(), platform: 'linux' };
    const lines = [];
    assert.equal(
        await main(['--out', '/e.json'], ctx, (l) => lines.push(l)),
        EXIT.REFUSED,
    );
    assert.equal(ctx.written.size, 0);
    assert.match(lines[0], /Windows 10 or Windows 11/);
});

test('main writes one redacted evidence file and refuses to overwrite it', async () => {
    const ctx = fakeContext();
    const lines = [];
    assert.equal(
        await main(
            [
                '--out',
                '/e.json',
                '--release',
                '/release',
                '--commit',
                'b'.repeat(40),
            ],
            ctx,
            (l) => lines.push(l),
        ),
        EXIT.OK,
    );
    const doc = JSON.parse(
        ctx.written.get(join('/e.json')) ?? [...ctx.written.values()][0],
    );
    assert.equal(doc.platform, 'win32');
    assert.equal(doc.commit, 'b'.repeat(40));
    assert.equal(doc.manual.length, MANUAL.length);
    assert.match(doc.operatorNote, /not package acceptance/);
    assert.doesNotMatch(JSON.stringify(doc), /nope/);
    assert.equal(await main(['--out', '/e.json'], ctx, () => {}), EXIT.REFUSED);
});

test('evidence counts every status', () => {
    const doc = evidence(fakeContext(), {}, [
        { id: 'a', status: 'pass' },
        { id: 'b', status: 'fail' },
        { id: 'c', status: 'manual' },
        { id: 'd', status: 'warn' },
    ]);
    assert.deepEqual(doc.counts, {
        pass: 1,
        warn: 1,
        fail: 1,
        error: 0,
        manual: 1,
    });
});

// ------------------------------------------------------------ readiness

test('readiness: the repository is release-ready (docs, tools, licenses, runbook)', async () => {
    assert.deepEqual(await readiness.sourceProblems(), []);
});

test('readiness: every harness manual item is a runbook scenario', () => {
    for (const { id } of MANUAL)
        assert.ok(readiness.SCENARIOS.includes(id), id);
});

test('readiness: runbook problems name missing scenarios and recorded results', () => {
    const problems = readiness.runbookProblems(
        '### A1. x\nResult (PASS/FAIL): `____`\n',
    );
    assert.ok(problems.includes('runbook: scenario B1 missing'));
    assert.ok(!problems.some((p) => p.includes('recorded')));
    const filled = readiness.runbookProblems('Result (PASS/FAIL): PASS\n');
    assert.ok(filled.some((p) => p.includes('recorded PASS/FAIL')));
    for (const line of [
        'Result (PASS/FAIL): `PASS`',
        'Result (PASS/FAIL): `fail`',
        'Result (PASS/FAIL): **PASS**',
        '| B1  | Clean install | `PASS` |',
    ])
        assert.ok(
            readiness
                .runbookProblems(line)
                .some((p) => p.includes('recorded PASS/FAIL')),
            line,
        );
});

test('readiness: components need a license, a pinned hash and https', () => {
    assert.deepEqual(
        readiness.componentProblems({
            schemaVersion: 1,
            a: { version: '1', bundle: {}, url: 'http://x', sha256: 'no' },
            b: { version: '1', license: 'MIT' },
        }),
        [
            'components: a has no license',
            'components: a sha256 not pinned',
            'components: a url not https',
        ],
    );
});

test('readiness: a copy missing a document or tool is not ready', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gpos-ready-'));
    try {
        await cp(readiness.SINGLE_PC, dir, { recursive: true });
        await rm(join(dir, 'operations', 'HANDOVER.md'));
        await rm(join(dir, 'backup', 'restore.mjs'));
        const recovery = join(dir, 'diagnostics', 'RECOVERY.md');
        await writeFile(
            recovery,
            (await readFile(recovery, 'utf8')).replaceAll(
                're-run the same restore',
                'x',
            ),
        );
        const problems = await readiness.sourceProblems(dir);
        assert.ok(problems.includes('doc missing: operations/HANDOVER.md'));
        assert.ok(problems.includes('tool missing: backup/restore.mjs'));
        assert.ok(
            problems.includes(
                'doc diagnostics/RECOVERY.md: must mention "re-run the same restore"',
            ),
        );
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('readiness: arguments', () => {
    assert.throws(() => readiness.parseArgs(['--bundle', 'x']), /together/);
    assert.throws(
        () => readiness.parseArgs(['--bundle', 'x', '--manifest-sha256', 'z']),
        /64 hex/,
    );
    assert.throws(() => readiness.parseArgs(['--what']), /Unknown/);
    assert.equal(readiness.parseArgs(['--json']).json, true);
});

test('readiness: a tampered or incomplete bundle is refused', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gpos-ready-bundle-'));
    try {
        await mkdir(join(dir, 'release'), { recursive: true });
        await writeFile(join(dir, 'release', 'a.txt'), 'a');
        const { sha256 } = await import('../installer/bundle.mjs');
        const manifest = JSON.stringify({
            version: '1.0.0',
            platform: 'win32-x64',
            components: {},
            files: { 'release/a.txt': sha256(Buffer.from('a')) },
        });
        await writeFile(join(dir, 'bundle-manifest.json'), manifest);
        const hash = sha256(Buffer.from(manifest));
        const problems = await readiness.bundleProblems(dir, hash);
        assert.ok(problems.includes('bundle: release/node/node.exe missing'));
        assert.ok(
            problems.some((p) => /node is not the pinned archive/.test(p)),
        );
        assert.ok(
            problems.includes(
                'bundle: COMPONENTS.md lacks the MongoDB SSPL notice',
            ),
        );
        const wrong = await readiness.bundleProblems(dir, 'f'.repeat(64));
        assert.match(wrong[0], /does not match/);
        await writeFile(join(dir, 'release', 'a.txt'), 'changed');
        const tampered = await readiness.bundleProblems(dir, hash);
        assert.match(tampered[0], /damaged or modified/);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('readiness: Caddy path placeholders are quoted (a space in C:\\Program Files splits them)', async () => {
    assert.deepEqual(await readiness.caddySourceProblems(), []);
    assert.deepEqual(
        readiness.caddyQuotingProblems(
            'x',
            [
                '\troot * {$GPOS_CLIENT_ROOT}',
                '\troot * "{$GPOS_CLIENT_ROOT}"',
                '\tfile {env.LOG_DIR}',
                '\tbind {$GPOS_LAN_IP}',
                '\t# root * {$IN_A_COMMENT}',
            ].join('\n'),
        ),
        [
            'caddy: x:1 has unquoted {$GPOS_CLIENT_ROOT}; quote it (a path with spaces splits)',
            'caddy: x:3 has unquoted {env.LOG_DIR}; quote it (a path with spaces splits)',
        ],
    );
});

test('readiness: --caddy takes a value', () => {
    assert.throws(() => readiness.parseArgs(['--caddy']), /needs a value/);
    assert.match(readiness.parseArgs(['--caddy', 'caddy']).caddy, /caddy$/);
});

test('readiness: the trust check node accepts --use-system-ca (#414)', async () => {
    assert.deepEqual(await readiness.systemCaProblems(process.execPath), []);
    const [problem] = await readiness.systemCaProblems(
        join(tmpdir(), 'no-such-node'),
    );
    assert.match(problem, /--use-system-ca/);
});
