// Portable backup policy tests (#363): no MongoDB needed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { layout, releaseLayout } from '../runtime/layout.mjs';
import { classifyLinux, classifyWindows } from './removable.mjs';
import {
    ARCHIVE,
    BackupError,
    EXCLUDED,
    INCLUDED_FILES,
    RETENTION_DAYS,
    backupId,
    backupStatus,
    exportBackup,
    checkBackup,
    compatibility,
    emptyStatus,
    parseArgs,
    prune,
    requiredFreeBytes,
    selectForPruning,
    statusSummary,
} from './backup.mjs';
import {
    SESSION_COLLECTIONS,
    lossRefusals,
    parseArgs as parseRestoreArgs,
} from './restore.mjs';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-14T02:00:00Z');
const ago = (days) => new Date(now.getTime() - days * DAY).toISOString();

test('backup ids sort by time and name their kind', () => {
    const id = backupId('scheduled', now);
    assert.match(id, /^20261114T020000Z-scheduled-[0-9a-f]{6}$/);
    assert.ok(backupId('manual', new Date(now.getTime() + 1000)) > id);
    assert.throws(() => backupId('other'));
});

test('retention removes verified backups past 30 days but never the newest verified one', () => {
    const b = (id, days, verified = true) => ({
        backupId: id,
        createdAt: ago(days),
        verified,
    });
    assert.equal(RETENTION_DAYS, 30);
    assert.deepEqual(
        selectForPruning([b('a', 40), b('b', 31), b('c', 1)], now),
        ['a', 'b'],
    );
    // Only old backups: the newest verified one stays, however old.
    assert.deepEqual(selectForPruning([b('a', 90), b('b', 60)], now), ['a']);
    // An unverified newer backup does not count as the one to keep.
    assert.deepEqual(selectForPruning([b('a', 60), b('x', 1, false)], now), []);
    assert.deepEqual(selectForPruning([b('a', 29), b('b', 2)], now), []);
    assert.deepEqual(selectForPruning([], now), []);
});

test('free space needs the estimate plus a margin and the reserve', () => {
    assert.equal(requiredFreeBytes(0, 0), 0);
    assert.equal(requiredFreeBytes(1000, 1), 1100 + 1048576);
});

test('compatibility: same MongoDB major.minor, app no newer than the target', () => {
    const m = { schema: 1, versions: { mongodb: '7.0.48', app: '1.2.0' } };
    assert.deepEqual(compatibility(m, { mongodb: '7.0.50', app: '1.2.0' }), []);
    assert.deepEqual(compatibility(m, { mongodb: '7.0.48', app: '1.3.0' }), []);
    assert.match(
        compatibility(m, { mongodb: '8.0.1', app: '1.2.0' })[0],
        /MongoDB 7\.0\.48/,
    );
    assert.match(
        compatibility(m, { mongodb: '7.0.48', app: '1.1.9' })[0],
        /newer/,
    );
    assert.match(
        compatibility(
            { ...m, schema: 2 },
            { mongodb: '7.0.48', app: '1.2.0' },
        )[0],
        /format/,
    );
});

test('status summary flags an overdue backup and a due export reminder', () => {
    const s = emptyStatus();
    assert.deepEqual(
        [
            statusSummary(s, now).backupOverdue,
            statusSummary(s, now).exportReminderDue,
        ],
        [true, true],
    );
    const fresh = {
        ...s,
        lastVerifiedSuccess: { at: ago(1) },
        lastExport: { at: ago(6) },
    };
    assert.equal(statusSummary(fresh, now).backupOverdue, false);
    assert.equal(statusSummary(fresh, now).exportReminderDue, false);
    const stale = {
        ...s,
        lastVerifiedSuccess: { at: ago(2) },
        lastExport: { at: ago(7) },
    };
    assert.equal(statusSummary(stale, now).backupOverdue, true);
    assert.equal(statusSummary(stale, now).exportReminderDue, true);
});

test('backups carry the secrets a replacement PC needs and say what they leave out', () => {
    for (const file of [
        'mongo-keyfile',
        'mongo-root-password',
        'mongo-api-password',
        'jwt-secret',
    ])
        assert.ok(INCLUDED_FILES.includes(`secrets/${file}`), file);
    // Rotated on restore instead, so pre-restore sessions end.
    assert.ok(!INCLUDED_FILES.includes('secrets/cookie-secret'));
    assert.ok(INCLUDED_FILES.includes('state/install.json'));
    for (const path of [
        'secrets/api.env',
        'secrets/cookie-secret',
        'tls/',
        'database/',
        'browser storage',
    ])
        assert.ok(
            EXCLUDED.some((e) => e.path === path && e.reason),
            path,
        );
    assert.deepEqual(SESSION_COLLECTIONS, [
        'refreshtokens',
        'stepups',
        'overridegrants',
    ]);
});

test('argument parsing is strict and paths are absolute', () => {
    const root = join(tmpdir(), 'x');
    assert.deepEqual(parseArgs(['status', '--data-root', root]), {
        command: 'status',
        dataRoot: root,
    });
    assert.throws(() => parseArgs(['status']), /--data-root is required/);
    assert.throws(
        () => parseArgs(['status', '--data-root', 'relative']),
        /absolute/,
    );
    assert.throws(() => parseArgs(['nope', '--data-root', root]), /Command/);
    assert.throws(() =>
        parseArgs(['status', '--data-root', root, '--data-root', root]),
    );
    assert.throws(() =>
        parseArgs(['prune', '--data-root', root, '--to', root]),
    );
    assert.throws(
        () =>
            parseArgs([
                'create',
                '--data-root',
                root,
                '--mongod',
                'm',
                '--tools',
                't',
                '--api',
                'a',
                '--kind',
                'pre-restore',
            ]),
        /kind/,
    );
    assert.equal(
        parseArgs([
            'export',
            '--data-root',
            root,
            '--to',
            root,
            '--test-allow-fixed-destination',
        ]).testAllowFixedDestination,
        true,
    );
    assert.throws(
        () => parseRestoreArgs(['--data-root', root, '--from', root]),
        /--confirm is required/,
    );
});

test('restore refuses each kind of loss until it is accepted on its own', () => {
    const found = { openShifts: 1, activeLeases: 2, newerSales: 3 };
    assert.equal(lossRefusals(found, {}).length, 3);
    assert.equal(
        lossRefusals(found, { acceptOpenShifts: true, acceptNewerSales: true })
            .length,
        1,
    );
    assert.match(
        lossRefusals(found, {
            acceptOpenShifts: true,
            acceptNewerSales: true,
        })[0],
        /offline cash/,
    );
    assert.deepEqual(
        lossRefusals({ openShifts: 0, activeLeases: 0, newerSales: 0 }, {}),
        [],
    );
});

/** A fabricated (archive-only) verified backup for listing/pruning tests. */
async function fakeBackup(dir, id, createdAt, { verified = true } = {}) {
    const root = join(dir, id);
    await mkdir(root, { recursive: true });
    const archive = Buffer.from(`archive ${id}`);
    await writeFile(join(root, ARCHIVE), archive);
    const sha256 = createHash('sha256').update(archive).digest('hex');
    const manifest = {
        schema: 1,
        backupId: id,
        kind: id.split('-')[1],
        installationId: 'i',
        createdAt,
        files: [{ path: ARCHIVE, size: archive.length, sha256 }],
    };
    const text = JSON.stringify(manifest);
    await writeFile(join(root, 'manifest.json'), text);
    await writeFile(
        join(root, 'manifest.sha256'),
        createHash('sha256').update(text).digest('hex'),
    );
    if (verified)
        await writeFile(
            join(root, 'verification.json'),
            JSON.stringify({ ok: true, backupId: id, archiveSha256: sha256 }),
        );
    return root;
}

test('prune and status work from the files, never from directory names alone', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gpos-backup-'));
    try {
        const paths = layout(join(dir, 'root'));
        await mkdir(paths.dirs.state, { recursive: true });
        await mkdir(paths.dirs.backups, { recursive: true });
        await writeFile(
            paths.install,
            JSON.stringify({ schema: 1, installationId: 'i' }),
        );
        const old1 = '20250101T000000Z-scheduled-aaaaaa';
        const old2 = '20250102T000000Z-scheduled-bbbbbb';
        const recent = '20261113T000000Z-scheduled-cccccc';
        const unverified = '20261114T000000Z-manual-dddddd';
        await fakeBackup(paths.dirs.backups, old1, '2025-01-01T00:00:00Z');
        await fakeBackup(paths.dirs.backups, old2, '2025-01-02T00:00:00Z');
        await fakeBackup(paths.dirs.backups, recent, '2026-11-13T00:00:00Z');
        await fakeBackup(
            paths.dirs.backups,
            unverified,
            '2026-11-14T00:00:00Z',
            { verified: false },
        );
        // A directory merely named like a backup is not a verified one.
        await mkdir(join(paths.dirs.backups, '20261114T010000Z-manual-eeeeee'));
        await mkdir(
            join(
                paths.dirs.backups,
                '.incomplete-20261114T020000Z-manual-ffffff',
            ),
        );

        let status = await backupStatus({ dataRoot: paths.root });
        assert.deepEqual(
            status.backups.filter((b) => b.verified).map((b) => b.backupId),
            [old1, old2, recent],
        );
        assert.equal(
            status.lastVerifiedSuccess,
            null,
            'success comes from status.json only',
        );

        const removed = await prune({ dataRoot: paths.root });
        assert.deepEqual(removed, [old1, old2]);
        const left = await readdir(paths.dirs.backups);
        assert.ok(left.includes(recent) && left.includes(unverified));
        assert.ok(
            !left.some((n) => n.startsWith('.incomplete-')),
            'interrupted output cleaned',
        );

        // The only verified backup is kept even when it is past retention.
        await rm(join(paths.dirs.backups, recent), { recursive: true });
        await fakeBackup(paths.dirs.backups, old1, '2025-01-01T00:00:00Z');
        assert.deepEqual(await prune({ dataRoot: paths.root }), []);

        // Corruption is detected by checksum, not by presence.
        const dirOld = join(paths.dirs.backups, old1);
        await checkBackup(dirOld);
        await writeFile(join(dirOld, ARCHIVE), 'tampered!!!!!!!!!!!!!!!!!!!');
        await assert.rejects(
            checkBackup(dirOld),
            (e) => e instanceof BackupError && e.code === 'BACKUP_CORRUPT',
        );
        await writeFile(join(dirOld, 'extra'), 'x');
        await assert.rejects(
            checkBackup(dirOld),
            (e) => e.code === 'BACKUP_CORRUPT',
        );
        await assert.rejects(
            checkBackup(join(paths.dirs.backups, unverified)),
            (e) => e.code === 'BACKUP_UNVERIFIED',
        );
        status = await backupStatus({ dataRoot: paths.root });
        assert.equal(status.exportReminderDue, true);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('the CLI refuses a root that is not an installation and exits with usage errors', () => {
    const cli = fileURLToPath(new URL('./backup.mjs', import.meta.url));
    let r = spawnSync(
        process.execPath,
        [cli, 'status', '--data-root', join(tmpdir(), 'gpos-none-363')],
        {
            encoding: 'utf8',
        },
    );
    assert.equal(r.status, 3);
    assert.match(r.stderr, /not a Grocery POS installation/);
    r = spawnSync(process.execPath, [cli], { encoding: 'utf8' });
    assert.equal(r.status, 2);
});

test('the release ships the pinned MongoDB Database Tools beside mongod', async () => {
    const components = JSON.parse(
        await readFile(new URL('../components.json', import.meta.url), 'utf8'),
    );
    assert.match(components.mongodbTools.version, /^100\.\d+\.\d+$/);
    assert.match(components.mongodbTools.sha256, /^[a-f0-9]{64}$/);
    assert.ok(
        components.mongodbTools.url.endsWith(
            `windows-x86_64-${components.mongodbTools.version}.zip`,
        ),
    );
    const release = releaseLayout('C:\\R');
    assert.ok(release.mongodump.endsWith('mongodump.exe'));
    assert.ok(release.mongorestore.endsWith('mongorestore.exe'));
    const ci = await readFile(
        new URL('../../../.github/workflows/ci.yml', import.meta.url),
        'utf8',
    );
    assert.match(ci, /pnpm test:single-pc-backup/);
    assert.match(ci, /\/usr\/bin\/mongodump/);
    // CI asserts the extracted tools are the pinned version.
    assert.match(ci, /mongodbTools\.version/);
});

test('exports go to removable media only, never the installation or system disk', () => {
    const usb = { driveType: 'Fixed', busType: 'USB', diskNumber: 1 };
    const root = { driveType: 'Fixed', busType: 'NVMe', diskNumber: 0 };
    // External USB disks often report a Fixed drive type; the bus decides.
    assert.deepEqual(classifyWindows(usb, root), {
        removable: true,
        reason: 'removable',
    });
    assert.equal(
        classifyWindows(
            { driveType: 'Removable', busType: 'SD', diskNumber: 2 },
            root,
        ).removable,
        true,
    );
    // A second internal disk, or a folder mount/subst onto one, is refused.
    assert.equal(
        classifyWindows(
            { driveType: 'Fixed', busType: 'SATA', diskNumber: 1 },
            root,
        ).reason,
        'fixed',
    );
    // subst/folder mounts resolve to the installation's own disk.
    assert.equal(
        classifyWindows({ ...usb, diskNumber: 0 }, root).reason,
        'same-disk',
    );
    assert.equal(
        classifyWindows({ ...usb, isBoot: true }, root).reason,
        'system-disk',
    );
    assert.equal(classifyWindows(undefined, root).reason, 'unknown');
    assert.equal(
        classifyLinux(
            { disk: '/sys/x/usb1/sdb', usb: true },
            { disk: '/sys/sda' },
        ).removable,
        true,
    );
    assert.equal(
        classifyLinux(
            { disk: '/sys/sdc', removableFlag: true },
            { disk: '/sys/sda' },
        ).removable,
        true,
    );
    assert.equal(
        classifyLinux({ disk: '/sys/sdb' }, { disk: '/sys/sda' }).reason,
        'fixed',
    );
    assert.equal(
        classifyLinux({ disk: '/sys/sda', usb: true }, { disk: '/sys/sda' })
            .reason,
        'same-disk',
    );
    assert.equal(classifyLinux(undefined, {}).reason, 'unknown');
});

test('an unreadable status file is kept aside and reported, never silently reset', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gpos-status-'));
    try {
        const paths = layout(join(dir, 'root'));
        await mkdir(paths.dirs.state, { recursive: true });
        await mkdir(paths.dirs.backups, { recursive: true });
        await writeFile(
            paths.install,
            JSON.stringify({ schema: 1, installationId: 'i' }),
        );
        await writeFile(paths.backupStatus, '{ not json');
        await assert.rejects(
            backupStatus({ dataRoot: paths.root }),
            /unreadable/,
        );
        // A command that records status keeps the damaged file beside.
        await assert.rejects(
            exportBackup({ dataRoot: paths.root, to: join(dir, 'none') }),
            (e) => e.code === 'NO_VERIFIED_BACKUP',
        );
        const names = await readdir(paths.dirs.backups);
        const kept = names.find((n) => n.startsWith('status.corrupt-'));
        assert.ok(kept, names.join());
        assert.equal(
            await readFile(join(paths.dirs.backups, kept), 'utf8'),
            '{ not json',
        );
        const status = await backupStatus({ dataRoot: paths.root });
        assert.ok(
            ['STATUS_CORRUPT', 'NO_VERIFIED_BACKUP'].includes(
                status.lastFailure.code,
            ),
        );
        assert.ok(status.consecutiveFailures >= 1);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
