// Real-MongoDB upgrade checks (#364). Needs MongoDB 7 `mongod`
// (GPOS_TEST_MONGOD), a directory with `mongodump`/`mongorestore`
// (GPOS_TEST_MONGO_TOOLS), a built API (apps/api/dist, for the restore's
// audit entry and the real data-version gate) and free loopback ports
// 27018/13000; skipped otherwise. Windows services are simulated by
// processes and pid files (fixture.test.mjs); everything else is the real
// upgrade, installer, provisioning, backup and restore code.
//   GPOS_TEST_MONGOD=… GPOS_TEST_MONGO_TOOLS=… node --test --test-concurrency=1 packaging/single-pc/upgrade/upgrade.db.test.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { boundedWait } from '../proof/policy.mjs';
import { SERVICES, layout } from '../runtime/layout.mjs';
import { createBackup, readRootPassword, rootUri } from '../backup/backup.mjs';
import { restore } from '../backup/restore.mjs';
import { runInstaller } from '../installer/install.mjs';
import {
    readJournal,
    runRollback,
    runUpgrade,
    upgradeStatus,
} from './upgrade.mjs';
import {
    makeBundle,
    once,
    posixContext,
    repoApi,
    testMigrations,
} from './fixture.test.mjs';

const MONGOD = process.env.GPOS_TEST_MONGOD;
const TOOLS = process.env.GPOS_TEST_MONGO_TOOLS;
const compiledApi = existsSync(join(repoApi, 'dist', 'main.js'));
const skip =
    (!MONGOD && 'GPOS_TEST_MONGOD not set') ||
    (!TOOLS && 'GPOS_TEST_MONGO_TOOLS not set') ||
    (!compiledApi && 'apps/api is not built');
const { MongoClient } = createRequire(join(repoApi, 'package.json'))(
    'mongoose',
).mongo;

const SALES = 40;
const cleanups = [];
afterEach(async () => {
    for (const fn of cleanups.splice(0).reverse()) await fn().catch(() => {});
});

class PowerCut extends Error {
    constructor(where) {
        super(`power cut ${where}`);
        this.name = 'PowerCut';
    }
}

/**
 * A complete installation of release A (data version 1) with populated
 * data and a verified scheduled backup, plus bundle B (data version 2 with
 * one migration). Services run.
 */
async function installation({ fault, migrations } = {}) {
    const dir = await mkdtemp(join(tmpdir(), 'gpos-upgrade-db-'));
    const a = await makeBundle(dir, {
        version: '1.0.0-a',
        appVersion: '1.0.0',
    });
    const registry = migrations ?? testMigrations();
    const b = await makeBundle(dir, {
        version: '1.1.0-b',
        appVersion: '1.1.0',
        migrations: registry,
        dataVersion: registry.length ? 2 : 1,
    });
    const ctx = posixContext(dir, {
        mongod: MONGOD,
        tools: TOOLS,
        migrations: registry,
        fault,
    });
    cleanups.push(async () => {
        await ctx.stopAll();
        await rm(dir, { recursive: true, force: true });
    });
    await runInstaller({ mode: 'install', ...a, adminUsername: 'owner' }, ctx);
    const paths = layout(ctx.locations.dataRoot);
    await withDb(paths, async (db) => {
        await db.collection('sales').insertMany(
            Array.from({ length: SALES }, (_, i) => ({
                total: 1000 + i,
                createdAt: new Date(Date.now() - 60_000),
            })),
        );
        await db
            .collection('shifts')
            .insertOne({ status: 'CLOSED', closedAt: new Date() });
    });
    await createBackup({
        dataRoot: paths.root,
        mongod: MONGOD,
        tools: TOOLS,
        api: repoApi,
        kind: 'scheduled',
    });
    return { dir, a, b, ctx, paths };
}

async function withDb(paths, fn) {
    const client = new MongoClient(rootUri(await readRootPassword(paths)), {
        serverSelectionTimeoutMS: 10_000,
    });
    await client.connect();
    try {
        return await fn(client.db('grocery'));
    } finally {
        await client.close();
    }
}

async function snapshot(paths) {
    return withDb(paths, async (db) => ({
        sales: await db.collection('sales').countDocuments(),
        migrated: await db
            .collection('sales')
            .countDocuments({ migrated: true }),
        marker: await db
            .collection('systemdataversion')
            .findOne(
                { _id: 'data' },
                { projection: { _id: 0, dataVersion: 1, state: 1 } },
            ),
        migrations: (
            await db.collection('systemmigrations').find().toArray()
        ).map((m) => `${m._id}:${m.state}`),
    }));
}

async function installed(paths) {
    return JSON.parse(
        await readFile(join(paths.dirs.state, 'installer.json'), 'utf8'),
    );
}

async function secretsOf(paths) {
    return Promise.all(
        Object.values(paths.secrets).map((p) => readFile(p, 'utf8')),
    );
}

async function health() {
    const r = await fetch('http://127.0.0.1:13000/v1/health/ready').catch(
        () => undefined,
    );
    return r?.status;
}

describe('single-PC upgrade on real MongoDB', { skip }, () => {
    test('populated upgrade: verified, backed up, migrated once, switched, ready; rerun refused unchanged', async () => {
        const { b, ctx, paths } = await installation();
        const secrets = await secretsOf(paths);
        const started = Date.now();
        const result = await runUpgrade(b, ctx);
        const took = Date.now() - started;
        assert.equal(result.state, 'complete');
        assert.deepEqual(result.migrationsApplied, ['test-flag-sales']);
        assert.match(result.backupId, /-pre-upgrade-/);
        assert.deepEqual(await snapshot(paths), {
            sales: SALES,
            migrated: SALES,
            marker: { dataVersion: 2, state: 'ready' },
            migrations: ['test-flag-sales:done'],
        });
        const state = await installed(paths);
        assert.equal(state.version, '1.1.0-b');
        assert.equal(state.complete, true);
        assert.equal(await health(), 200);
        // Previous release kept for rollback; secrets untouched.
        assert.deepEqual((await readdir(ctx.locations.releasesDir)).sort(), [
            '1.0.0-a',
            '1.1.0-b',
        ]);
        assert.deepEqual(await secretsOf(paths), secrets);
        // Services are automatic again.
        const reg = await ctx.registered();
        assert.equal(reg[SERVICES.api], 'auto');
        assert.equal(reg[SERVICES.proxy], 'auto');
        for (const stage of [
            'stop',
            'backup',
            'place',
            'migrate',
            'switch',
            'ready',
        ])
            assert.equal(typeof result.timings[stage], 'number', stage);
        console.log(
            `upgrade timings (ms): ${JSON.stringify(result.timings)}; wall ${took}`,
        );

        await assert.rejects(
            runUpgrade(b, ctx),
            (e) =>
                e.name === 'RefusedError' &&
                /already installed/.test(e.message),
        );
        assert.equal((await snapshot(paths)).migrated, SALES);
    });

    test('refusals change nothing: open shift, offline lease, overdue backup, downgrade, MongoDB series, low disk, invalid artifact', async () => {
        const { dir, b, ctx, paths } = await installation();
        const before = await snapshot(paths);
        const refused = async (bundle, pattern, context = ctx) => {
            await assert.rejects(runUpgrade(bundle, context), (e) => {
                assert.equal(e.name, 'RefusedError', e.message);
                assert.match(e.message, pattern);
                return true;
            });
            assert.deepEqual(await snapshot(paths), before);
            assert.equal(await readJournal(paths), undefined);
            assert.equal(await ctx.running(SERVICES.api), true);
            assert.equal((await installed(paths)).version, '1.0.0-a');
        };
        await withDb(paths, (db) =>
            db.collection('shifts').insertOne({ _id: 'open', status: 'OPEN' }),
        );
        await refused(b, /shift\(s\) are open/);
        await withDb(paths, (db) =>
            db.collection('shifts').deleteOne({ _id: 'open' }),
        );
        await withDb(paths, (db) =>
            db
                .collection('offlineleases')
                .insertOne({ _id: 'l', active: true }),
        );
        await refused(b, /offline cash leases/);
        await withDb(paths, (db) =>
            db.collection('offlineleases').deleteOne({ _id: 'l' }),
        );

        const status = JSON.parse(await readFile(paths.backupStatus, 'utf8'));
        const old = new Date(Date.now() - 40 * 3600 * 1000).toISOString();
        await writeFile(
            paths.backupStatus,
            JSON.stringify({
                ...status,
                lastVerifiedSuccess: { ...status.lastVerifiedSuccess, at: old },
            }),
        );
        await refused(b, /overdue/);
        await writeFile(
            paths.backupStatus,
            JSON.stringify({
                ...status,
                lastFailure: {
                    at: new Date().toISOString(),
                    command: 'create',
                    code: 'X',
                },
            }),
        );
        await refused(b, /last backup failed/);
        await writeFile(paths.backupStatus, JSON.stringify(status));

        const older = await makeBundle(dir, {
            version: '0.9.0-z',
            appVersion: '0.9.0',
        });
        // Each bundle's tool carries its own registry (none here).
        const own = { ...ctx, migrations: [] };
        await refused(older, /downgrades are not supported/, own);
        // A tool that is not the bundle's own is refused too.
        await refused(older, /does not belong to the bundle/);
        const mongo8 = await makeBundle(dir, {
            version: '1.2.0-m',
            appVersion: '1.2.0',
            mongodb: '8.0.4',
        });
        await refused(mongo8, /one MongoDB release series/, own);
        await refused(b, /Not enough free disk space/, {
            ...ctx,
            freeBytes: async () => 1024,
        });
        // Invalid artifact: wrong out-of-band hash, then a tampered file.
        await refused(
            { ...b, manifestSha256: 'f'.repeat(64) },
            /does not match the SHA-256/,
        );
        await writeFile(
            join(b.bundle, 'release', 'api', 'dist', 'main.js'),
            '// changed',
        );
        await refused(b, /damaged or modified/);
    });

    test('interrupted at every stage boundary: each re-run resumes and completes exactly once', async () => {
        const cuts = [];
        for (const stage of [
            'stop',
            'backup',
            'place',
            'migrate',
            'switch',
            'ready',
        ])
            cuts.push(
                [stage, 'before'],
                ...(stage === 'migrate' ? [[stage, 'data']] : []),
                [stage, 'after'],
            );
        let armed;
        const { b, ctx, paths } = await installation({
            fault: (stage, when) => {
                if (armed && armed[0] === stage && armed[1] === when) {
                    armed = undefined;
                    throw new PowerCut(`${when} ${stage}`);
                }
            },
        });
        // Each cut leaves the journal where a killed process would; the next
        // run resumes past it. The last cut is followed by completion.
        for (const cut of cuts) {
            armed = cut;
            await assert.rejects(
                runUpgrade(b, ctx),
                (e) => e.name === 'PowerCut',
            );
            const journal = await readJournal(paths);
            assert.equal(journal.state, 'running', cut.join(' '));
            // The old API never starts on a half-upgraded database.
            if (journal.markerTouched && !journal.stages.switch)
                assert.equal(await ctx.running(SERVICES.api), false);
            assert.equal(armed, undefined, `cut ${cut.join(' ')} fired`);
        }
        const result = await runUpgrade(b, ctx);
        assert.equal(result.state, 'complete');
        assert.deepEqual(await snapshot(paths), {
            sales: SALES,
            migrated: SALES,
            marker: { dataVersion: 2, state: 'ready' },
            migrations: ['test-flag-sales:done'],
        });
        assert.equal(await health(), 200);
    });

    test('a process killed mid-migration resumes; the old release cannot start meanwhile', async () => {
        const { dir, b, ctx, paths } = await installation();
        const harness = join(dir, 'harness.mjs');
        await writeFile(
            harness,
            `import { runUpgrade } from ${JSON.stringify(new URL('./upgrade.mjs', import.meta.url).href)};
import { posixContext, testMigrations } from ${JSON.stringify(new URL('./fixture.test.mjs', import.meta.url).href)};
const ctx = posixContext(${JSON.stringify(dir)}, { mongod: ${JSON.stringify(MONGOD)}, tools: ${JSON.stringify(TOOLS)}, migrations: testMigrations({ slowMs: 200 }) });
await runUpgrade(${JSON.stringify(b)}, ctx);
`,
        );
        const child = spawn(process.execPath, [harness], { stdio: 'ignore' });
        await boundedWait(
            async () => {
                const j = await readJournal(paths).catch(() => undefined);
                if (!j?.dataChanged) return false;
                return (await snapshot(paths)).migrated >= 3;
            },
            { timeoutMs: 120_000, intervalMs: 100 },
        );
        child.kill('SIGKILL');
        await once(child, 'exit');
        const mid = await snapshot(paths);
        assert.ok(
            mid.migrated > 0 && mid.migrated < SALES,
            `partly migrated (${mid.migrated})`,
        );
        assert.equal(mid.marker.state, 'migrating');
        // The previous release's API refuses this data (its gate).
        await ctx.setStartMode(SERVICES.api, 'auto');
        await ctx.startService(SERVICES.api);
        await assert.rejects(
            ctx.waitReady(SERVICES.api),
            /exited during startup/,
        );
        const status = await upgradeStatus(ctx);
        assert.equal(status.recovery.action, 'restore-required');
        // Re-running the same upgrade finishes it (the migration converges).
        const result = await runUpgrade(b, ctx);
        assert.equal(result.state, 'complete');
        assert.equal((await snapshot(paths)).migrated, SALES);
    });

    test('a failed data migration needs explicit restore; restore refuses later sales unless accepted; then the previous release runs', async () => {
        const { b, ctx, paths } = await installation({
            migrations: testMigrations({ failAfter: 5 }),
        });
        await assert.rejects(
            runUpgrade(b, ctx),
            /migration failed on purpose.*rollback --restore-backup/s,
        );
        const journal = await readJournal(paths);
        assert.equal(journal.state, 'needs-recovery');
        assert.equal(journal.dataChanged, true);
        assert.equal(await ctx.running(SERVICES.api), false);
        assert.equal((await ctx.registered())[SERVICES.api], 'demand');

        await assert.rejects(
            runRollback({}, ctx),
            (e) =>
                e.name === 'RefusedError' && /--restore-backup/.test(e.message),
        );
        await assert.rejects(
            runRollback({ restoreBackup: 'nope' }, ctx),
            (e) =>
                e.name === 'RefusedError' &&
                /must name this upgrade's pre-upgrade backup/.test(e.message),
        );
        // A sale recorded after the pre-upgrade backup (e.g. by hand) is never silently lost.
        await withDb(paths, (db) =>
            db
                .collection('sales')
                .insertOne({ total: 1, createdAt: new Date() }),
        );
        await assert.rejects(
            runRollback({ restoreBackup: journal.backupId }, ctx),
            (e) => e.name === 'RefusedError' && /would be lost/.test(e.message),
        );
        const result = await runRollback(
            { restoreBackup: journal.backupId, acceptNewerSales: true },
            ctx,
        );
        assert.equal(result.state, 'rolled-back');
        const after = await snapshot(paths);
        assert.equal(after.sales, SALES);
        assert.equal(after.migrated, 0);
        assert.deepEqual(after.marker, { dataVersion: 1, state: 'ready' });
        assert.equal((await installed(paths)).version, '1.0.0-a');
        assert.equal(await health(), 200);
        await assert.rejects(runRollback({}, ctx), /no unfinished upgrade/);
    });

    test('a failure before any data change rolls the binaries back automatically', async () => {
        const { b, ctx, paths } = await installation({
            fault: (stage, when) => {
                if (stage === 'place' && when === 'before')
                    throw new Error('copy failed');
            },
        });
        await assert.rejects(
            runUpgrade(b, ctx),
            /copy failed.*previous release 1\.0\.0-a is running again; no data was changed/s,
        );
        const journal = await readJournal(paths);
        assert.equal(journal.state, 'rolled-back');
        assert.equal(journal.dataChanged, false);
        assert.equal((await installed(paths)).version, '1.0.0-a');
        assert.equal(await health(), 200);
        assert.equal((await snapshot(paths)).sales, SALES);
        // A later upgrade with the same bundle starts afresh and completes.
        ctx.fault = undefined;
        assert.equal((await runUpgrade(b, ctx)).state, 'complete');
    });

    test('a new release that never becomes ready, with no data migration, is rolled back automatically', async () => {
        const { dir, ctx, paths } = await installation({ migrations: [] });
        const broken = await makeBundle(dir, {
            version: '1.0.1-c',
            appVersion: '1.0.1',
            apiMain: 'process.exit(1);\n',
        });
        await assert.rejects(
            runUpgrade(broken, ctx),
            /exited during startup.*previous release 1\.0\.0-a is running again; no data was changed/s,
        );
        assert.equal((await readJournal(paths)).state, 'rolled-back');
        assert.equal((await installed(paths)).version, '1.0.0-a');
        assert.equal(await health(), 200);
        assert.deepEqual((await snapshot(paths)).marker, {
            dataVersion: 1,
            state: 'ready',
        });
    });

    test('a damaged installed release is refused before the upgrade; damaged during it, the rollback refuses and leaves it in place', async () => {
        const { b, ctx, paths } = await installation({
            fault: async (stage, when) => {
                if (stage === 'place' && when === 'before') {
                    // Damage the previous release after preflight (e.g. AV).
                    await writeFile(
                        join(ctx.locations.releasesDir, '1.0.0-a', 'stray.txt'),
                        'x',
                    );
                    throw new Error('copy failed');
                }
            },
        });
        const oldRelease = join(ctx.locations.releasesDir, '1.0.0-a');
        const main = join(oldRelease, 'api', 'dist', 'main.js');
        const original = await readFile(main, 'utf8');
        // Before: the installed release must match its own recorded manifest.
        await writeFile(main, original + '\n// tampered');
        const saved = ctx.fault;
        ctx.fault = undefined;
        await assert.rejects(
            runUpgrade(b, ctx),
            (e) =>
                e.name === 'RefusedError' &&
                /does not match its recorded manifest/.test(e.message),
        );
        assert.equal(await readJournal(paths), undefined);
        await writeFile(main, original);
        ctx.fault = saved;
        // During: the rollback refuses without moving the release aside.
        await assert.rejects(
            runUpgrade(b, ctx),
            /copy failed.*Rolling back also failed.*no longer matches its recorded manifest.*left in place/s,
        );
        assert.equal((await readJournal(paths)).state, 'rollback-failed');
        assert.deepEqual((await readdir(ctx.locations.releasesDir)).sort(), [
            '1.0.0-a',
        ]);
        assert.equal(await readFile(main, 'utf8'), original);
        // Once the stray file is gone, the rollback completes.
        await rm(join(oldRelease, 'stray.txt'));
        assert.equal((await runRollback({}, ctx)).state, 'rolled-back');
        assert.equal(await health(), 200);
    });

    test('restoring an older-data backup migrates it forward; a newer-data backup is refused', async () => {
        const { b, ctx, paths } = await installation();
        const old = (
            await readdir(paths.dirs.backups, { withFileTypes: true })
        ).find((e) => e.isDirectory() && /-scheduled-/.test(e.name)).name;
        assert.equal((await runUpgrade(b, ctx)).state, 'complete');
        const newer = await createBackup({
            dataRoot: paths.root,
            mongod: MONGOD,
            tools: TOOLS,
            api: repoApi,
            kind: 'manual',
        });
        await ctx.stopService(SERVICES.api);
        const bin = { mongod: MONGOD, tools: TOOLS, api: repoApi };
        // This release (data version 2) restoring last week's v1 backup.
        const result = await restore(
            {
                dataRoot: paths.root,
                from: join(paths.dirs.backups, old),
                confirm: old,
                ...bin,
                dataVersion: 2,
                migrations: testMigrations(),
                acceptNewerSales: true,
            },
            () => {},
        );
        assert.deepEqual(result.migrated, ['test-flag-sales']);
        assert.deepEqual(await snapshot(paths), {
            sales: SALES,
            migrated: SALES,
            marker: { dataVersion: 2, state: 'ready' },
            migrations: ['test-flag-sales:done'],
        });
        await ctx.startService(SERVICES.api);
        await ctx.waitReady(SERVICES.api);
        assert.equal(await health(), 200);
        await ctx.stopService(SERVICES.api);
        // A release of data version 1 cannot run the v2 backup.
        await assert.rejects(
            restore(
                {
                    dataRoot: paths.root,
                    from: join(paths.dirs.backups, newer.backupId),
                    confirm: newer.backupId,
                    ...bin,
                    dataVersion: 1,
                    migrations: [],
                },
                () => {},
            ),
            (e) =>
                e.name === 'RefusedError' &&
                /data version 2, newer than this release's 1/.test(e.message),
        );
    });

    test('the real compiled API refuses to start on another data version', async () => {
        const { ctx, paths } = await installation();
        await ctx.stopService(SERVICES.api);
        await withDb(paths, (db) =>
            db
                .collection('systemdataversion')
                .updateOne(
                    { _id: 'data' },
                    { $set: { dataVersion: 2, state: 'ready' } },
                    { upsert: true },
                ),
        );
        const child = spawn(
            process.execPath,
            [`--env-file=${paths.apiEnv}`, join(repoApi, 'dist', 'main.js')],
            {
                stdio: ['ignore', 'pipe', 'pipe'],
                cwd: repoApi,
            },
        );
        let out = '';
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (out += d));
        const timer = setTimeout(() => child.kill('SIGKILL'), 90_000);
        const [code] = await once(child, 'exit');
        clearTimeout(timer);
        assert.notEqual(code, 0);
        assert.match(out, /data version 2; this release needs 1/);
        assert.equal(await health(), undefined);
    });
});
