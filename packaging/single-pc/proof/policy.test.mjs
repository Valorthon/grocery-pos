import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
    assertWindows11,
    boundedWait,
    components,
    parseArgs,
    verifyArchive,
} from './policy.mjs';

const target = {
    platform: 'win32',
    arch: 'x64',
    caption: 'Microsoft Windows 11 Pro',
    productType: 1,
    build: 26200,
    cpu: 'GenuineIntel',
};

test('platform evidence refuses Server, Windows 10, ARM, Linux and missing OS evidence', () => {
    assert.doesNotThrow(() => assertWindows11(target));
    assert.doesNotThrow(() =>
        assertWindows11({ ...target, cpu: 'AuthenticAMD' }),
    );
    for (const change of [
        { platform: 'linux' },
        { arch: 'arm64' },
        { productType: 3 },
        { productType: 2 },
        { caption: 'Microsoft Windows Server 2025' },
        { caption: 'Microsoft Windows 10 Pro' },
        { build: 19045 },
        { build: NaN },
        { cpu: 'unknown' },
        { productType: undefined },
    ]) {
        assert.throws(() => assertWindows11({ ...target, ...change }));
    }
});

test('proof CLI accepts no DB URL, secret, missing, duplicated or unknown options', () => {
    const args = [
        '--api',
        'artifact',
        '--node-archive',
        'node.zip',
        '--mongo-archive',
        'mongo.zip',
        '--output',
        'evidence.json',
        '--commit',
        'a'.repeat(40),
    ];
    assert.equal(parseArgs(args).api, 'artifact');
    for (const invalid of [
        args.slice(0, -2),
        [...args, '--api', 'other'],
        [...args, '--database-url', 'mongodb://customer'],
        [...args, '--password', 'secret'],
        [...args.slice(0, -1), 'HEAD'],
        [...args, '--output'],
    ])
        assert.throws(() => parseArgs(invalid));
});

test('archive corruption or an absent hash fails before component execution', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gpos-proof-test-'));
    try {
        const path = join(dir, 'archive.zip');
        await writeFile(path, 'abc');
        await verifyArchive(
            path,
            'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        );
        await assert.rejects(verifyArchive(path, '0'.repeat(64)));
        await assert.rejects(verifyArchive(path, ''));
        await writeFile(path, 'corrupt');
        await assert.rejects(
            verifyArchive(
                path,
                'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
            ),
        );
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('readiness cannot silently succeed on a timeout or failed operation', async () => {
    await assert.rejects(
        boundedWait(() => new Promise(() => {}), {
            timeoutMs: 5,
            intervalMs: 1,
        }),
    );
    await assert.rejects(
        boundedWait(async () => false, { timeoutMs: 5, intervalMs: 1 }),
    );
    await assert.rejects(
        boundedWait(async () => {
            throw new Error('failed');
        }),
    );
    let attempts = 0;
    await boundedWait(async () => ++attempts === 2, {
        timeoutMs: 100,
        intervalMs: 1,
    });
    assert.equal(attempts, 2);
});

test('proof components have exact versions and official immutable archive locations', async () => {
    const pins = await components();
    assert.equal(pins.platform, 'win32-x64');
    for (const key of ['node', 'mongodb']) {
        assert.match(pins[key].version, /^\d+\.\d+\.\d+$/);
        assert.match(pins[key].sha256, /^[a-f0-9]{64}$/);
        assert.ok(pins[key].url.includes(pins[key].version));
        assert.equal(new URL(pins[key].url).protocol, 'https:');
    }
});

test(
    'actual CLI refuses this non-Windows host before opening nonexistent artifacts or emitting evidence',
    { skip: process.platform === 'win32' },
    async () => {
        const dir = await mkdtemp(join(tmpdir(), 'gpos-proof-refusal-'));
        try {
            const output = join(dir, 'evidence.json');
            const result = spawnSync(
                process.execPath,
                [
                    fileURLToPath(new URL('./run.mjs', import.meta.url)),
                    '--api',
                    join(dir, 'missing-api'),
                    '--node-archive',
                    join(dir, 'missing-node.zip'),
                    '--mongo-archive',
                    join(dir, 'missing-mongo.zip'),
                    '--output',
                    output,
                    '--commit',
                    'a'.repeat(40),
                ],
                { encoding: 'utf8', timeout: 3000 },
            );
            assert.equal(result.error, undefined);
            assert.equal(result.status, 1);
            assert.equal(result.stdout, '');
            assert.equal(
                result.stderr,
                'Architecture proof failed; no passing evidence was produced. Check the documented prerequisites.\n',
            );
            await assert.rejects(
                stat(output),
                (error) => error.code === 'ENOENT',
            );
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    },
);
