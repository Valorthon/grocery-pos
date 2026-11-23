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
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { layout, releaseLayout } from '../runtime/layout.mjs';
import { classifyLinux, classifyWindows } from './removable.mjs';
import {
    ARCHIVE,
    BackupError,
    CA_ROOT_FILES,
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
    blockingLeases,
    describeLeaseTerminals,
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
    // #396: the Caddy root pair only, never the intermediate or site certs.
    assert.deepEqual(CA_ROOT_FILES, [
        'tls/data/caddy/pki/authorities/local/root.crt',
        'tls/data/caddy/pki/authorities/local/root.key',
    ]);
    const paths = layout('/pd');
    for (const rel of CA_ROOT_FILES)
        assert.ok(
            join('/pd', ...rel.split('/')).startsWith(paths.caddyRoot),
            rel,
        );
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
    // No operator option bypasses the removable-only export rule.
    for (const flag of ['--test-allow-fixed-destination', '--allow-same-disk'])
        assert.throws(() =>
            parseArgs(['export', '--data-root', root, '--to', root, flag]),
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

test('restore names the terminals whose leases block (#453)', () => {
    const [refusal] = lossRefusals(
        {
            openShifts: 0,
            activeLeases: 2,
            leaseTerminals: [
                { terminalId: 't-1', label: 'Till 1', cashier: 'ana' },
                { terminalId: 't-2', label: '', cashier: '' },
            ],
            newerSales: 0,
        },
        {},
    );
    assert.match(refusal, /Till 1 \(terminal t-1, cashier ana\); terminal t-2/);
    assert.equal(
        describeLeaseTerminals([{ terminalId: '', label: '', cashier: 'bo' }]),
        'terminal unknown, cashier bo',
    );
});

test('blockingLeases asks only for active, unexpired leases on OPEN shifts (#453)', async () => {
    let pipeline;
    const now = new Date('2026-11-23T00:00:00Z');
    const db = {
        collection: (name) => {
            assert.equal(name, 'offlineleases');
            return {
                aggregate: (p) => {
                    pipeline = p;
                    return {
                        toArray: async () => [
                            {
                                _id: { terminalId: 't-1', shift: 's' },
                                label: 'Till 1',
                                cashier: 'ana',
                            },
                        ],
                    };
                },
            };
        },
    };
    assert.deepEqual(await blockingLeases(db, now), [
        { terminalId: 't-1', label: 'Till 1', cashier: 'ana' },
    ]);
    assert.deepEqual(pipeline[0], {
        $match: { active: true, expiresAt: { $gt: now } },
    });
    assert.deepEqual(pipeline[3], { $match: { 'shiftDoc.status': 'OPEN' } });
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

test('the export CLI refuses a fixed destination unless the test harness allows it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gpos-export-'));
    try {
        const paths = layout(join(dir, 'root'));
        await mkdir(paths.dirs.state, { recursive: true });
        await mkdir(paths.dirs.backups, { recursive: true });
        await writeFile(
            paths.install,
            JSON.stringify({ schema: 1, installationId: 'i' }),
        );
        await fakeBackup(
            paths.dirs.backups,
            '20261113T000000Z-scheduled-cccccc',
            '2026-11-13T00:00:00Z',
        );
        const to = join(dir, 'fixed');
        await mkdir(to);
        const cli = fileURLToPath(new URL('./backup.mjs', import.meta.url));
        const args = [cli, 'export', '--data-root', paths.root, '--to', to];
        const { GPOS_TEST_ALLOW_FIXED_DESTINATION: _, ...env } = process.env;
        let r = spawnSync(process.execPath, args, { encoding: 'utf8', env });
        assert.equal(r.status, 1);
        assert.match(
            r.stderr,
            /DESTINATION_(SAME_DISK|NOT_REMOVABLE|UNKNOWN_MEDIA)/,
        );
        assert.deepEqual(await readdir(to), []);
        r = spawnSync(
            process.execPath,
            [...args, '--test-allow-fixed-destination'],
            {
                encoding: 'utf8',
                env,
            },
        );
        assert.equal(r.status, 2, 'no bypass option');
        r = spawnSync(process.execPath, args, {
            encoding: 'utf8',
            env: { ...env, GPOS_TEST_ALLOW_FIXED_DESTINATION: '1' },
        });
        assert.equal(r.status, 0, r.stderr);
        assert.deepEqual(await readdir(to), [
            'GroceryPOS-backup-20261113T000000Z-scheduled-cccccc',
        ]);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('a fresh restore makes the root and secrets admin-only before copying secrets (#366)', async () => {
    const { secureFreshRoot, secureFolderSteps, aclProblems } =
        await import('./restore.mjs');
    const { symlink } = await import('node:fs/promises');
    const { writeFileSync } = await import('node:fs');
    assert.deepEqual(secureFolderSteps('C:\\r')[0], [
        'icacls',
        ['C:\\r', '/setowner', '*S-1-5-32-544'],
    ]);
    assert.ok(secureFolderSteps('C:\\r')[1][1].includes('/inheritance:r'));
    assert.deepEqual(
        aclProblems({ Owner: 'S-1-5-32-544', Sids: ['S-1-5-18'] }),
        [],
    );
    assert.deepEqual(
        aclProblems({ Owner: 'S-1-5-21-1-2-3-1001', Sids: ['S-1-1-0'] }),
        ['owned by S-1-5-21-1-2-3-1001', 'grants S-1-1-0'],
    );
    const ADMIN = { Owner: 'S-1-5-32-544', Sids: ['S-1-5-18', 'S-1-5-32-544'] };
    const USER = {
        Owner: 'S-1-5-21-1-2-3-1001',
        Sids: ['S-1-5-21-1-2-3-1001'],
    };
    const dir = await mkdtemp(join(tmpdir(), 'gpos-secure-'));
    let n = 0;
    // Recorded Windows answers: Get-Acl facts per path (default admin-only),
    // icacls succeeds; `onIcacls` lets a test act between the steps.
    const run = async ({ prepare, acl = {}, onIcacls } = {}) => {
        const base = join(dir, `case-${n++}`);
        const parent = join(base, 'Valorthon');
        const paths = layout(join(parent, 'GroceryPOS'));
        await mkdir(base);
        await prepare?.({ base, parent, paths });
        const calls = [];
        const exec = (file, args) => {
            calls.push([file, ...args].join(' '));
            if (file === 'icacls') {
                onIcacls?.(args, paths);
                return '';
            }
            const path = Object.keys(acl).find((k) =>
                args.at(-1).includes(`/${k}'`),
            );
            return JSON.stringify(path ? acl[path] : ADMIN);
        };
        try {
            await secureFreshRoot(paths, { platform: 'win32', exec });
            return { calls, paths, parent, ok: true };
        } catch (error) {
            return { calls, paths, parent, error };
        }
    };
    try {
        // Parent and root absent: both created; parent, root and secrets
        // each get owner + inheritance removed, then are checked.
        const good = await run();
        assert.ok(good.ok, good.error?.message);
        for (const path of [
            good.parent,
            good.paths.root,
            good.paths.dirs.secrets,
        ])
            assert.ok(
                good.calls.includes(`icacls ${path} /setowner *S-1-5-32-544`),
                path,
            );
        assert.equal(
            good.calls.filter((c) => c.includes('/inheritance:r')).length,
            3,
        );

        // An existing parent owned by a standard user: refused, nothing made.
        const ownedParent = await run({
            prepare: ({ parent }) => mkdir(parent),
            acl: {},
        });
        assert.ok(ownedParent.ok); // admin-owned parent is fine
        const hostileParent = await run({
            prepare: async ({ parent }) => {
                await mkdir(parent);
            },
            acl: { Valorthon: USER },
        });
        assert.match(
            hostileParent.error.message,
            /Valorthon is owned by S-1-5-21/,
        );
        assert.ok(!existsSync(hostileParent.paths.root));
        assert.ok(!hostileParent.calls.some((c) => c.startsWith('icacls')));

        // An admin-owned parent must not let Users replace/delete its children.
        const unsafeParent = await run({
            prepare: ({ parent }) => mkdir(parent),
            acl: {
                Valorthon: {
                    ...ADMIN,
                    Rules: [
                        {
                            Sid: 'S-1-1-0',
                            Allow: true,
                            Rights: 0x40,
                            InheritOnly: false,
                        },
                    ],
                },
            },
        });
        assert.match(unsafeParent.error.message, /mutation rights to S-1-1-0/);
        assert.ok(!existsSync(unsafeParent.paths.root));
        const inheritedMutation = await run({
            prepare: ({ parent }) => mkdir(parent),
            acl: {
                Valorthon: {
                    ...ADMIN,
                    Rules: [
                        {
                            Sid: 'S-1-5-32-545',
                            Allow: true,
                            Rights: 0x1f01ff,
                            InheritOnly: true,
                        },
                    ],
                },
            },
        });
        assert.match(
            inheritedMutation.error.message,
            /mutation rights to S-1-5-32-545/,
        );
        assert.ok(!existsSync(inheritedMutation.paths.root));
        const creatorOwner = await run({
            prepare: ({ parent }) => mkdir(parent),
            acl: {
                Valorthon: {
                    ...ADMIN,
                    Rules: [
                        {
                            Sid: 'S-1-3-0',
                            Allow: true,
                            Rights: 0x1f01ff,
                            InheritOnly: true,
                        },
                    ],
                },
            },
        });
        assert.ok(creatorOwner.ok, creatorOwner.error?.message);
        const readableParent = await run({
            prepare: ({ parent }) => mkdir(parent),
            acl: {
                Valorthon: {
                    ...ADMIN,
                    Sids: [...ADMIN.Sids, 'S-1-5-32-545'],
                    Rules: [
                        {
                            Sid: 'S-1-5-32-545',
                            Allow: true,
                            Rights: 0x1200a9,
                            InheritOnly: false,
                        },
                    ],
                },
            },
        });
        assert.ok(readableParent.ok, readableParent.error?.message);

        // A pre-created root owned by a standard user: refused, untouched.
        const hostileRoot = await run({
            prepare: ({ paths }) => mkdir(paths.root, { recursive: true }),
            acl: { GroceryPOS: USER },
        });
        assert.match(
            hostileRoot.error.message,
            /already exists and is owned by/,
        );
        assert.ok(
            !hostileRoot.calls.some((c) =>
                c.startsWith(`icacls ${hostileRoot.paths.root} `),
            ),
        );

        // The root is a junction/link to another folder: refused.
        const junction = await run({
            prepare: async ({ base, parent, paths }) => {
                await mkdir(parent);
                await mkdir(join(base, 'elsewhere'));
                await symlink(join(base, 'elsewhere'), paths.root, 'junction');
            },
        });
        assert.match(junction.error.message, /link or junction/);
        assert.ok(
            !existsSync(join(dir, `case-${n - 1}`, 'elsewhere', 'secrets')),
        );

        // A secrets link planted inside an existing empty-looking root.
        const plantedSecrets = await run({
            prepare: async ({ base, paths }) => {
                await mkdir(paths.root, { recursive: true });
                await mkdir(join(base, 'loot'));
                await symlink(
                    join(base, 'loot'),
                    paths.dirs.secrets,
                    'junction',
                );
            },
        });
        assert.match(plantedSecrets.error.message, /link or junction/);

        // Something appears in the root while it is being secured.
        const raced = await run({
            onIcacls: (args, paths) => {
                if (args[0] === paths.dirs.secrets && args[1] === '/setowner')
                    writeFileSync(join(paths.root, 'planted'), 'x');
            },
        });
        assert.match(raced.error.message, /unexpected entries \(planted\)/);

        // A grant that survives restriction: refused before any secret.
        const leaky = await run({
            acl: { secrets: { Owner: 'S-1-5-32-544', Sids: ['S-1-5-32-545'] } },
        });
        assert.match(
            leaky.error.message,
            /not admin-only \(grants S-1-5-32-545\)/,
        );
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('export verification reserves one work folder and never removes another run (#366)', async () => {
    const { reserveVerifyWork } = await import('./backup.mjs');
    const dir = await mkdtemp(join(tmpdir(), 'gpos-verify-left-'));
    const work = join(dir, 'Valorthon', 'GroceryPOS-Verify');
    try {
        await reserveVerifyWork(work);
        // Even an empty live run is exclusive: a second run cannot remove it.
        await assert.rejects(reserveVerifyWork(work), /Restart the PC/);
        assert.ok(existsSync(work));
        // No scratch metadata is read and no mongod shutdown is attempted.
        const scratch = join(work, '.verify-live');
        await mkdir(scratch);
        await writeFile(join(scratch, 'port'), 'untrusted metadata');
        await assert.rejects(
            reserveVerifyWork(work),
            /Do not delete it while a check is running/,
        );
        assert.equal(
            await readFile(join(scratch, 'port'), 'utf8'),
            'untrusted metadata',
        );
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('a raced parent is inspected before any ACL operation (#366)', async () => {
    const { secureParent } = await import('./acl.mjs');
    const dir = await mkdtemp(join(tmpdir(), 'gpos-parent-race-'));
    const parent = join(dir, 'Valorthon');
    const calls = [];
    try {
        await assert.rejects(
            secureParent(parent, {
                platform: 'win32',
                mkdir: async (path) => {
                    await mkdir(path);
                    throw Object.assign(new Error('raced'), { code: 'EEXIST' });
                },
                exec: (file) => {
                    calls.push(file);
                    return JSON.stringify({
                        Owner: 'S-1-5-21-hostile',
                        Sids: [],
                    });
                },
            }),
            /owned by S-1-5-21-hostile/,
        );
        assert.deepEqual(calls, ['powershell.exe']);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
