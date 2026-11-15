// Portable tests for the single-PC upgrade (#364): policy, registry,
// arguments, bundle manifest and the installer/PowerShell entry points.
// The real-MongoDB runs are upgrade.db.test.mjs.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { layout } from '../runtime/layout.mjs';
import { REQUIRED_RELEASE_FILES, TOOL_DIRS } from '../installer/bundle.mjs';
import { runInstaller } from '../installer/install.mjs';
import { KINDS, ID_PATTERN, backupId } from '../backup/backup.mjs';
import {
    DATA_VERSION,
    LEGACY_NOT_APPLICABLE,
    MIGRATIONS,
    dataCompatibility,
    pendingMigrations,
    validateRegistry,
} from './migrations.mjs';
import {
    STAGES,
    evaluateUpgrade,
    parseArgs,
    recoveryPlan,
    releaseData,
} from './upgrade.mjs';
import {
    makeBundle,
    posixContext,
    repo,
    testMigrations,
} from './fixture.test.mjs';

const m = (id, from, extra = {}) => ({
    id,
    from,
    to: from + 1,
    up: async () => {},
    ...extra,
});

test('the registry data version is the one the API enforces (contracts)', async () => {
    const source = await readFile(
        join(repo, 'packages', 'contracts', 'src', 'release.ts'),
        'utf8',
    );
    const declared = Number(
        /export const SINGLE_PC_DATA_VERSION = (\d+);/.exec(source)?.[1],
    );
    assert.equal(DATA_VERSION, declared);
    assert.doesNotThrow(() => validateRegistry(MIGRATIONS, DATA_VERSION));
    // The cloud's legacy backfills never run on single-PC data.
    assert.deepEqual([...LEGACY_NOT_APPLICABLE].sort(), [
        'migrate:categories',
        'migrate:decode-entities',
        'migrate:stock-ledger',
    ]);
    assert.deepEqual(dataCompatibility().migrations, []);
});

test('migrations must be unique, ordered, contiguous and reach the data version', () => {
    assert.doesNotThrow(() =>
        validateRegistry([m('aaa-one', 1), m('bbb-two', 2)], 3),
    );
    assert.throws(
        () => validateRegistry([m('aaa-one', 1)], 3),
        /end at data version 2/,
    );
    assert.throws(
        () => validateRegistry([m('aaa-one', 1), m('aaa-one', 2)], 3),
        /listed twice/,
    );
    assert.throws(
        () => validateRegistry([m('aaa-one', 2)], 3),
        /expected 1 → 2/,
    );
    assert.throws(
        () => validateRegistry([{ ...m('aaa-one', 1), to: 3 }], 3),
        /goes 1 → 3/,
    );
    assert.throws(() => validateRegistry([m('A!', 1)], 2), /not valid/);
    assert.throws(
        () => validateRegistry([{ ...m('aaa-one', 1), up: undefined }], 2),
        /no up\(\)/,
    );
    const list = [m('aaa-one', 1), m('bbb-two', 2), m('ccc-three', 3)];
    assert.deepEqual(
        pendingMigrations(list, 2, 4).map((x) => x.id),
        ['bbb-two', 'ccc-three'],
    );
    assert.deepEqual(pendingMigrations(list, 4, 4), []);
    assert.deepEqual(
        dataCompatibility([m('aaa-one', 1, { changesData: false })], 2)
            .migrations,
        [{ id: 'aaa-one', from: 1, to: 2, changesData: false }],
    );
});

const release = (version, appVersion, dataVersion = 1, extra = {}) => ({
    version,
    appVersion,
    mongodb: '7.0.48',
    data: {
        dataVersion,
        minUpgradeFromDataVersion: 1,
        migrations: [],
        ...extra,
    },
});
const now = new Date().toISOString();
const okFacts = {
    from: release('1.0.0-a', '1.0.0'),
    to: release('1.1.0-b', '1.1.0', 2),
    database: { dataVersion: 1, state: 'ready', fcv: '7.0' },
    openShifts: 0,
    activeLeases: 0,
    backup: {
        lastVerifiedSuccess: { at: now },
        lastFailure: null,
        backupOverdue: false,
    },
    free: { program: 10 * 1024 ** 3, data: 50 * 1024 ** 3 },
    releaseBytes: 400 * 1024 ** 2,
};

test('preflight refuses every unsafe upgrade and passes a safe one', () => {
    assert.deepEqual(evaluateUpgrade(okFacts), []);
    const refused = (change, pattern) => {
        const out = evaluateUpgrade({ ...okFacts, ...change });
        assert.ok(
            out.some((r) => pattern.test(r)),
            `${pattern}: ${out.join(' | ')}`,
        );
    };
    refused({ to: okFacts.from }, /already installed/);
    refused(
        { to: release('0.9.0-z', '0.9.0') },
        /older than the installed app/,
    );
    refused(
        {
            from: release('1.0.0-a', '1.0.0', 3),
            database: { ...okFacts.database, dataVersion: 3 },
        },
        /reads data version 2, older/,
    );
    refused(
        { to: release('3.0.0', '3.0.0', 5, { minUpgradeFromDataVersion: 4 }) },
        /Install the intermediate release first/,
    );
    refused(
        { to: { ...okFacts.to, mongodb: '8.0.4' } },
        /one MongoDB release series/,
    );
    refused(
        { database: { ...okFacts.database, fcv: '6.0' } },
        /feature compatibility is 6\.0/,
    );
    refused(
        { database: { ...okFacts.database, state: 'migrating' } },
        /being upgraded/,
    );
    refused(
        { database: { ...okFacts.database, dataVersion: 2 } },
        /data version 2, the installed release 1/,
    );
    refused({ openShifts: 2 }, /2 shift\(s\) are open/);
    refused({ activeLeases: 1 }, /offline cash leases/);
    refused(
        { backup: { ...okFacts.backup, lastVerifiedSuccess: null } },
        /no verified backup/,
    );
    refused({ backup: { ...okFacts.backup, backupOverdue: true } }, /overdue/);
    refused(
        {
            backup: {
                ...okFacts.backup,
                lastVerifiedSuccess: { at: '2026-01-01T00:00:00Z' },
                lastFailure: { at: now },
            },
        },
        /last backup failed/,
    );
    refused({ free: { ...okFacts.free, program: 1024 } }, /new release/);
    refused({ free: { ...okFacts.free, data: 1024 } }, /pre-upgrade backup/);
    // An older failure followed by a verified backup is fine.
    assert.deepEqual(
        evaluateUpgrade({
            ...okFacts,
            backup: {
                ...okFacts.backup,
                lastFailure: { at: '2026-01-01T00:00:00Z' },
            },
        }),
        [],
    );
    // A release from before #364 reads data version 1.
    assert.deepEqual(releaseData({}), {
        dataVersion: 1,
        minUpgradeFromDataVersion: 1,
        migrations: [],
    });
});

test('recovery: binary rollback until data changed, then only restore or finish', () => {
    assert.equal(recoveryPlan(undefined).action, 'none');
    assert.equal(recoveryPlan({ state: 'complete' }).action, 'none');
    assert.equal(
        recoveryPlan({ state: 'running', stages: {}, current: null }).action,
        'none',
    );
    assert.equal(
        recoveryPlan({ state: 'running', stages: {}, current: 'stop' }).action,
        'binary-rollback',
    );
    assert.equal(
        recoveryPlan({
            state: 'failed',
            stages: { stop: 1 },
            dataChanged: false,
        }).action,
        'binary-rollback',
    );
    assert.deepEqual(
        recoveryPlan({
            state: 'needs-recovery',
            stages: { stop: 1 },
            dataChanged: true,
            backupId: 'x',
        }),
        { action: 'restore-required', backupId: 'x' },
    );
    assert.deepEqual(
        [...STAGES],
        [
            'verify',
            'preflight',
            'stop',
            'backup',
            'place',
            'migrate',
            'switch',
            'ready',
        ],
    );
});

test('arguments are validated per command', () => {
    const sha = 'a'.repeat(64);
    assert.deepEqual(
        parseArgs([
            'upgrade',
            '--bundle',
            'b',
            '--manifest',
            'm',
            '--manifest-sha256',
            sha,
        ]),
        { command: 'upgrade', bundle: 'b', manifest: 'm', manifestSha256: sha },
    );
    assert.throws(
        () => parseArgs(['upgrade', '--bundle', 'b']),
        /--manifest is required/,
    );
    assert.throws(
        () =>
            parseArgs([
                'upgrade',
                '--bundle',
                'b',
                '--manifest',
                'm',
                '--manifest-sha256',
                'x',
            ]),
        /SHA-256/,
    );
    assert.deepEqual(
        parseArgs([
            'rollback',
            '--restore-backup',
            'id',
            '--accept-newer-sales',
        ]),
        {
            command: 'rollback',
            restoreBackup: 'id',
            acceptNewerSales: true,
        },
    );
    assert.throws(
        () => parseArgs(['rollback', '--accept-newer-sales']),
        /only goes with/,
    );
    assert.throws(
        () => parseArgs(['status', '--bundle', 'b']),
        /Unknown option/,
    );
    assert.throws(() => parseArgs(['downgrade']), /first argument/);
});

test('the pre-upgrade backup kind is a #363 kind, never selectable from the CLI', () => {
    assert.ok(KINDS.includes('pre-upgrade'));
    assert.match(backupId('pre-upgrade'), ID_PATTERN);
});

test('bundles ship the upgrade tool and record data compatibility', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gpos-upgrade-'));
    try {
        assert.ok(TOOL_DIRS.includes('upgrade'));
        for (const f of [
            'tools/upgrade/upgrade.mjs',
            'tools/upgrade/migrations.mjs',
        ])
            assert.ok(REQUIRED_RELEASE_FILES.includes(f), f);
        const b = await makeBundle(dir, {
            version: '1.1.0-b',
            appVersion: '1.1.0',
            migrations: testMigrations(),
            dataVersion: 2,
        });
        const manifest = JSON.parse(await readFile(b.manifest, 'utf8'));
        assert.equal(manifest.appVersion, '1.1.0');
        assert.deepEqual(manifest.data, {
            dataVersion: 2,
            minUpgradeFromDataVersion: 1,
            migrations: [
                { id: 'test-flag-sales', from: 1, to: 2, changesData: true },
            ],
            legacyMigrationsNotApplicable: [...LEGACY_NOT_APPLICABLE],
        });
        const info = JSON.parse(
            await readFile(join(b.bundle, 'release', 'VERSION.json'), 'utf8'),
        );
        assert.deepEqual(info.data, manifest.data);
        // Test helpers never ship.
        assert.ok(
            !Object.keys(manifest.files).some((f) => /\.test\.mjs$/.test(f)),
        );
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('repair refuses another version: that is the upgrade tool', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gpos-upgrade-'));
    try {
        const b = await makeBundle(dir, {
            version: '1.1.0-b',
            appVersion: '1.1.0',
        });
        const ctx = posixContext(dir, {});
        const paths = layout(ctx.locations.dataRoot);
        await mkdir(paths.dirs.state, { recursive: true });
        await writeFile(paths.install, '{"installationId":"x"}');
        await writeFile(
            join(paths.dirs.state, 'installer.json'),
            JSON.stringify({ version: '1.0.0-a', complete: true }),
        );
        await assert.rejects(
            runInstaller({ mode: 'repair', ...b }, ctx),
            (e) =>
                e.name === 'RefusedError' &&
                /upgrade tool \(upgrade\.mjs\), not repair/.test(e.message),
        );
        assert.equal(ctx.log.length, 0, 'nothing ran');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('Install.ps1 runs the bundle-verified upgrade tool for the upgrade modes', async () => {
    const ps = await readFile(
        new URL('../installer/Install.ps1', import.meta.url),
        'utf8',
    );
    for (const mode of ['upgrade', 'upgrade-rollback', 'upgrade-status'])
        assert.match(ps, new RegExp(`'${mode}'`));
    assert.match(ps, /tools\\upgrade\\upgrade\.mjs/);
    assert.match(ps, /'--restore-backup', \$RestoreBackup/);
    assert.match(ps, /\$Mode -eq 'upgrade'\) \{\s*\n\s*# The manifest bytes/);
    // Still no download or execution from the bundle folder.
    assert.doesNotMatch(ps, /Invoke-WebRequest|Start-BitsTransfer|iex\b/i);
    // Restore options only go with upgrade-rollback.
    assert.match(
        ps,
        /\(\$RestoreBackup -or \$AcceptNewerSales\) -and \$Mode -ne 'upgrade-rollback'[\s\S]*?Stop-Refused/,
    );
    assert.match(ps, /\$AcceptNewerSales -and -not \$RestoreBackup/);
});

test('a restore checks the backup data version against the release', async () => {
    const { compatibility } = await import('../backup/backup.mjs');
    const manifest = (data, dataState) => ({
        schema: 1,
        versions: { mongodb: '7.0.48', app: '1.0.0', data, dataState },
    });
    const target = {
        mongodb: '7.0.48',
        app: '1.0.0',
        dataVersion: 2,
        minDataVersion: 1,
    };
    assert.deepEqual(compatibility(manifest(2, 'ready'), target), []);
    // Older data is migrated forward by restore.mjs; pre-#364 backups are 1.
    assert.deepEqual(compatibility(manifest(1, 'ready'), target), []);
    assert.deepEqual(compatibility(manifest(), target), []);
    assert.match(
        compatibility(manifest(3, 'ready'), target).join(),
        /data version 3, newer than this release's 2/,
    );
    assert.match(
        compatibility(manifest(2, 'migrating'), target).join(),
        /while an upgrade was migrating/,
    );
    assert.match(
        compatibility(manifest(1, 'ready'), {
            ...target,
            minDataVersion: 2,
        }).join(),
        /migrates from 2 only/,
    );
});
