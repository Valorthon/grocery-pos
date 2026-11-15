// Real-MongoDB diagnostics checks (#365). Needs a MongoDB 7 `mongod`
// (GPOS_TEST_MONGOD) and free loopback ports 27018/13000/1443; skipped
// otherwise. Provisions a throwaway installation (#360), then checks the
// CLI against a running and a stopped database, and rotates the log.
//   GPOS_TEST_MONGOD=… node --test packaging/single-pc/diagnostics/diagnose.db.test.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
    chmod,
    mkdtemp,
    readFile,
    readdir,
    rm,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { boundedWait } from '../proof/policy.mjs';
import { layout } from '../runtime/layout.mjs';

const MONGOD = process.env.GPOS_TEST_MONGOD;
const repo = fileURLToPath(new URL('../../..', import.meta.url));
const apiDir = join(repo, 'apps', 'api');
const provisionCli = fileURLToPath(
    new URL('../runtime/provision.mjs', import.meta.url),
);
const cli = fileURLToPath(new URL('./diagnose.mjs', import.meta.url));

function run(args) {
    const child = spawn(process.execPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    return once(child, 'exit').then(([code]) => ({ code, stdout, stderr }));
}

async function check(root) {
    const { code, stdout } = await run([
        cli,
        'check',
        '--data-root',
        root,
        '--api',
        apiDir,
        '--json',
    ]);
    const report = JSON.parse(stdout);
    return {
        code,
        report,
        byId: (id) => report.checks.find((c) => c.id === id),
    };
}

describe(
    'diagnostics against a real installation',
    { skip: !MONGOD && 'GPOS_TEST_MONGOD not set' },
    () => {
        let root;
        let paths;
        let mongod;

        before(async () => {
            root = await mkdtemp(join(tmpdir(), 'gpos-diag-db-'));
            paths = layout(root);
            const p = await run([
                provisionCli,
                '--data-root',
                root,
                '--mongod',
                MONGOD,
                '--api',
                apiDir,
            ]);
            assert.equal(p.code, 0, p.stderr);
            await writeFile(
                join(paths.dirs.state, 'installer.json'),
                JSON.stringify({
                    version: 'test',
                    release: join(root, 'no-release'),
                    stages: {},
                    complete: true,
                }),
            );
            mongod = spawn(MONGOD, ['--config', paths.mongodConfig], {
                stdio: 'ignore',
            });
            await boundedWait(
                async () =>
                    (await check(root)).byId('database').status === 'ok',
                {
                    timeoutMs: 60_000,
                    intervalMs: 1000,
                },
            );
        });

        after(async () => {
            if (mongod && mongod.exitCode === null) {
                mongod.kill('SIGTERM');
                await once(mongod, 'exit');
            }
            await chmod(paths.dirs.secrets, 0o700).catch(() => {});
            await rm(root, { recursive: true, force: true });
        });

        test('database up, API down: distinguished, with steps; secrets never read', async () => {
            await chmod(paths.dirs.secrets, 0o000);
            try {
                const { code, byId, report } = await check(root);
                assert.equal(code, 1);
                assert.equal(byId('database').status, 'ok');
                assert.equal(byId('database').details.isWritablePrimary, true);
                assert.equal(byId('api').status, 'fail');
                assert.ok(byId('api').steps.length > 0);
                assert.equal(byId('ports').status, 'fail');
                assert.deepEqual(byId('ports').details.mongo.reachable, [
                    '127.0.0.1',
                ]);
                if (process.platform === 'linux')
                    assert.deepEqual(byId('ports').details.mongo.listeners, [
                        '127.0.0.1',
                    ]);
                assert.equal(byId('backups').status, 'fail'); // never backed up
                assert.ok(['ok', 'warn', 'fail'].includes(byId('disk').status));
                assert.doesNotMatch(JSON.stringify(report), /mongodb:\/\/[^[]/);
            } finally {
                await chmod(paths.dirs.secrets, 0o700);
            }
        });

        test('rotate-logs rotates mongod.log and keeps a bounded number', async () => {
            for (let i = 0; i < 3; i++) {
                const r = await run([
                    cli,
                    'rotate-logs',
                    '--data-root',
                    root,
                    '--api',
                    apiDir,
                    '--keep',
                    '2',
                ]);
                assert.equal(r.code, 0, r.stderr);
                await new Promise((d) => setTimeout(d, 1100)); // distinct timestamps
            }
            const rotated = (await readdir(paths.dirs.logs)).filter((f) =>
                f.startsWith('mongod.log.'),
            );
            assert.equal(rotated.length, 2);
            assert.ok((await readdir(paths.dirs.logs)).includes('mongod.log'));
        });

        test('database stopped: the database check fails with steps', async () => {
            mongod.kill('SIGTERM');
            await once(mongod, 'exit');
            const { byId } = await check(root);
            assert.equal(byId('database').status, 'fail');
            assert.ok(byId('database').steps.length > 0);
            const rotate = await run([
                cli,
                'rotate-logs',
                '--data-root',
                root,
                '--api',
                apiDir,
            ]);
            assert.equal(rotate.code, 1);
            assert.match(rotate.stderr, /the database is not running/);
        });

        test('support export from the real installation is redacted', async () => {
            const out = await mkdtemp(join(tmpdir(), 'gpos-diag-usb-'));
            try {
                const r = await run([
                    cli,
                    'export',
                    '--data-root',
                    root,
                    '--api',
                    apiDir,
                    '--to',
                    out,
                ]);
                assert.equal(r.code, 0, r.stderr);
                const [file] = await readdir(out);
                const text = await readFile(join(out, file), 'utf8');
                const content = JSON.parse(text);
                assert.ok(content.logs.database.length > 0);
                assert.doesNotMatch(text, /\b127\.0\.0\.1\b/);
                const secrets = await Promise.all(
                    Object.values(paths.secrets).map((p) =>
                        readFile(p, 'utf8'),
                    ),
                );
                for (const value of secrets)
                    assert.ok(!text.includes(value.trim().slice(0, 20)));
            } finally {
                await rm(out, { recursive: true, force: true });
            }
        });
    },
);
