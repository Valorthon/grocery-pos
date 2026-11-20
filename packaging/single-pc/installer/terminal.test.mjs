// LAN terminal package and join plan (#397).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import {
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { layout } from '../runtime/layout.mjs';
import { caddyRootCertificate } from './plan.mjs';
import {
    TerminalRefusedError,
    checkInfo,
    joinPlan,
    parseArgs,
    readStoredLanIp,
    terminalInfo,
    timeSteps,
    writePackage,
} from './terminal.mjs';

const here = dirname(fileURLToPath(import.meta.url));

function makeCert(ca) {
    return execFileSync(
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
            '/CN=Caddy Local Authority',
            '-days',
            '30',
            '-addext',
            `basicConstraints=critical,CA:${ca ? 'TRUE' : 'FALSE'}`,
        ],
        { stdio: ['ignore', 'pipe', 'ignore'] },
    );
}

let rootA;
let rootB;
let tmp;
before(async () => {
    rootA = makeCert(true);
    rootB = makeCert(true);
    tmp = await mkdtemp(join(tmpdir(), 'gpos-terminal-'));
});
after(() => rm(tmp, { recursive: true, force: true }));

const facts = (info) => ({
    actualRootSha256: info.rootSha256,
    actualRoot: { thumbprint: info.rootThumbprint, ca: true },
});
const sha = (b) => createHash('sha256').update(b).digest('hex');

test('the package info pins the root by SHA-256 and SHA-1 thumbprint', () => {
    const info = terminalInfo('192.168.1.10', rootA);
    assert.equal(info.serverUrl, 'https://192.168.1.10:1443');
    assert.equal(info.rootSha256, sha(rootA));
    const thumb = new X509Certificate(rootA).fingerprint.replace(/:/g, '');
    assert.equal(info.rootThumbprint, thumb);
    assert.equal(checkInfo(info), info);
    assert.doesNotMatch(JSON.stringify(info), /PRIVATE KEY/);
});

test('no package without a LAN IP or a CA root', () => {
    assert.throws(() => terminalInfo(null, rootA), TerminalRefusedError);
    assert.throws(() => terminalInfo('none', rootA), /LAN terminals are off/);
    assert.throws(() => terminalInfo('8.8.8.8', rootA), /private IPv4/);
    assert.throws(
        () => terminalInfo('192.168.1.10', makeCert(false)),
        /not a CA/,
    );
    assert.throws(
        () => terminalInfo('192.168.1.10', Buffer.from('x')),
        TerminalRefusedError,
    );
});

test('join refuses a root whose hash differs and changes nothing', () => {
    const info = terminalInfo('192.168.1.10', rootA);
    assert.throws(
        () => joinPlan({ mode: 'join', info, actualRootSha256: sha(rootB) }),
        /SHA-256 differs/,
    );
    assert.throws(
        () =>
            joinPlan({
                mode: 'join',
                info: { ...info, serverUrl: 'https://evil:1443' },
                ...facts(info),
            }),
        /not valid/,
    );
});

test('join trusts, records, sets time, makes the shortcut, then checks TLS without health', () => {
    const info = terminalInfo('192.168.1.10', rootA);
    const steps = joinPlan({
        mode: 'join',
        info,
        actualRootSha256: info.rootSha256.toUpperCase(),
        actualRoot: { thumbprint: info.rootThumbprint.toLowerCase(), ca: true },
    });
    assert.deepEqual(
        steps.map((s) => s.kind),
        [
            'trust',
            'record',
            'exec',
            'start-service',
            'exec',
            'exec',
            'shortcut',
            'verify-tls',
        ],
    );
    assert.equal(
        steps.find((s) => s.kind === 'verify-tls').url,
        'https://192.168.1.10:1443/',
    );
    assert.doesNotMatch(JSON.stringify(steps), /health/);
    assert.ok(!steps.some((s) => s.kind === 'untrust'));
    // Joining again with the same root is harmless and removes nothing.
    const again = joinPlan({
        mode: 'join',
        info,
        ...facts(info),
        recorded: { thumbprint: info.rootThumbprint },
    });
    assert.ok(!again.some((s) => s.kind === 'untrust'));
});

test('join with another recorded root is refused; rejoin replaces it by thumbprint', () => {
    const old = terminalInfo('192.168.1.10', rootA);
    const info = terminalInfo('192.168.1.20', rootB);
    const recorded = {
        thumbprint: old.rootThumbprint,
        serverUrl: old.serverUrl,
    };
    assert.throws(
        () =>
            joinPlan({
                mode: 'join',
                info,
                ...facts(info),
                recorded,
            }),
        /Use rejoin/,
    );
    const steps = joinPlan({
        mode: 'rejoin',
        info,
        ...facts(info),
        recorded,
    });
    assert.deepEqual(steps[0], {
        kind: 'untrust',
        thumbprint: old.rootThumbprint,
    });
    assert.equal(steps[1].kind, 'trust');
    assert.equal(
        steps.find((s) => s.kind === 'record').thumbprint,
        info.rootThumbprint,
    );
    // A rejoin also refuses a mismatched root before removing the old one.
    assert.throws(
        () =>
            joinPlan({
                mode: 'rejoin',
                info,
                actualRootSha256: old.rootSha256,
                recorded,
            }),
        /SHA-256 differs/,
    );
});

test('a root.crt whose own thumbprint or CA flag differs is refused before trust', () => {
    const info = terminalInfo('192.168.1.10', rootA);
    const other = terminalInfo('192.168.1.10', rootB);
    assert.throws(
        () =>
            joinPlan({
                mode: 'join',
                info,
                actualRootSha256: info.rootSha256,
                actualRoot: { thumbprint: other.rootThumbprint, ca: true },
            }),
        /thumbprint differs/,
    );
    assert.throws(
        () =>
            joinPlan({
                mode: 'join',
                info,
                actualRootSha256: info.rootSha256,
                actualRoot: { thumbprint: info.rootThumbprint, ca: false },
            }),
        /thumbprint differs/,
    );
    assert.throws(
        () =>
            joinPlan({ mode: 'join', info, actualRootSha256: info.rootSha256 }),
        /thumbprint differs/,
    );
    assert.throws(
        () => checkInfo({ ...info, lanIp: 'none', serverUrl: null }),
        /not valid/,
    );
});

test('leave removes only the recorded root and the shortcut', () => {
    const steps = joinPlan({
        mode: 'leave',
        recorded: { thumbprint: 'AB'.repeat(20) },
    });
    assert.deepEqual(steps, [
        { kind: 'untrust', thumbprint: 'AB'.repeat(20) },
        { kind: 'remove-shortcut' },
        { kind: 'forget' },
    ]);
    assert.throws(
        () => joinPlan({ mode: 'leave', recorded: null }),
        /not joined/,
    );
    assert.throws(() => joinPlan({ mode: 'other' }), /mode is one of/);
});

test('the terminal takes its time from the main PC', () => {
    const steps = timeSteps('192.168.1.10');
    assert.deepEqual(steps[0].args, ['config', 'w32time', 'start=', 'auto']);
    assert.deepEqual(steps[2].args, [
        '/config',
        '/manualpeerlist:192.168.1.10,0x8',
        '/syncfromflags:manual',
        '/update',
    ]);
    assert.equal(steps[3].warnOnly, true);
});

test('package writes the public root, info, script and readme from the stored LAN IP', async () => {
    const dataRoot = join(tmp, 'data');
    const paths = layout(dataRoot);
    await mkdir(dirname(caddyRootCertificate(paths)), { recursive: true });
    await writeFile(caddyRootCertificate(paths), rootA);
    assert.equal(await readStoredLanIp(paths), null);
    await mkdir(paths.dirs.state, { recursive: true });
    await writeFile(
        join(paths.dirs.state, 'installer.json'),
        JSON.stringify({ lanIp: '192.168.1.10' }),
    );
    const lanIp = await readStoredLanIp(paths);
    assert.equal(lanIp, '192.168.1.10');
    const to = join(tmp, 'usb');
    const { dir } = await writePackage({
        dataRoot,
        to,
        lanIp,
        scriptDir: here,
    });
    assert.equal(dir, join(to, 'GroceryPOS-terminal-192.168.1.10'));
    assert.deepEqual((await readdir(dir)).sort(), [
        'JoinTerminal.ps1',
        'README.txt',
        'root.crt',
        'terminal.json',
    ]);
    assert.deepEqual(await readFile(join(dir, 'root.crt')), rootA);
    const info = JSON.parse(await readFile(join(dir, 'terminal.json'), 'utf8'));
    assert.equal(info.rootSha256, sha(rootA));
    assert.match(await readFile(join(dir, 'README.txt'), 'utf8'), /-Mode join/);
    assert.deepEqual(await readdir(to), ['GroceryPOS-terminal-192.168.1.10']);
    await assert.rejects(
        writePackage({ dataRoot, to, lanIp: null, scriptDir: here }),
        /LAN terminals are off/,
    );
    await assert.rejects(
        writePackage({
            dataRoot: join(tmp, 'empty'),
            to,
            lanIp,
            scriptDir: here,
        }),
        /root certificate is missing/,
    );
});

test('package arguments', () => {
    assert.deepEqual(
        parseArgs(['package', '--data-root', 'D', '--to', 'E:\\']),
        {
            dataRoot: 'D',
            to: 'E:\\',
        },
    );
    assert.throws(() => parseArgs(['join']), /package/);
    assert.throws(() => parseArgs(['package', '--to', 'E:\\']), /required/);
    assert.throws(() => parseArgs(['package', '--x', '1']), /Unknown/);
});

test('JoinTerminal.ps1 follows the plan', async () => {
    const ps = await readFile(
        new URL('JoinTerminal.ps1', import.meta.url),
        'utf8',
    );
    assert.match(ps, /\[ValidateSet\('join', 'rejoin', 'leave'\)\]/);
    assert.match(ps, /Get-FileHash -Algorithm SHA256/);
    assert.match(ps, /certutil\.exe -addstore -f Root \$rootFile/);
    // Deleted by thumbprint only, never by name.
    assert.match(ps, /certutil\.exe -delstore Root \$Thumbprint/);
    assert.doesNotMatch(ps, /-delstore Root ['"]?Caddy/);
    assert.match(ps, /\/manualpeerlist:' \+ \$info\.lanIp \+ ',0x8'/);
    assert.match(ps, /Tls12/);
    assert.doesNotMatch(ps.replace(/<#[\s\S]*?#>/, ''), /health/);
    // The hash check comes before any change.
    assert.ok(ps.indexOf('Get-FileHash') < ps.indexOf('-addstore'));
    assert.ok(
        ps.indexOf('Use -Mode rejoin') <
            ps.lastIndexOf('Remove-Root $recorded'),
    );
    const make = await readFile(
        new URL('MakeTerminalPackage.ps1', import.meta.url),
        'utf8',
    );
    assert.match(make, /-Verb RunAs/);
    assert.match(make, /'package', '--data-root'/);
    assert.match(make, /Certificate thumbprint: \$fingerprint/);
    assert.match(make, /compare/i);
    assert.match(ps, /X509Certificate2/);
    assert.match(ps, /compare/i);
    assert.ok(ps.indexOf('X509Certificate2') < ps.indexOf('-addstore'));
    assert.ok(
        ps.indexOf('Write-Host "Certificate thumbprint') <
            ps.indexOf('-addstore'),
    );
});
