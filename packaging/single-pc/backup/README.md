# Single-PC backups and restore (#363)

Owner-operable backup commands ([backup.mjs](backup.mjs)) and the separate,
protected restore tool ([restore.mjs](restore.mjs)) for the installation
that [../runtime/](../runtime/README.md) (#360) provisions. They do not
depend on the installer: #362 schedules `create` daily and installs shortcuts;
#364 takes a backup before an upgrade; #365 reads the status interface.

**Status:** exercised on Linux with real MongoDB 7.0.48 and Database Tools
100.20.1 (below). No Windows 11 execution yet; see "Windows-only proof".

Owner decisions applied (#357/#363): daily automatic local backups kept 30
days; guided export to an external drive with no recovery password, weekly
export reminders; restore only through this separate tool with explicit
confirmation; documented replacement-PC reinstall/restore with no recovery-time
promise; no cloud sync; the store owner holds credentials and keys.

## Commands

All run with the release's own `node.exe` as an administrator (they read
`secrets\`). `--tools` is the directory holding `mongodump`/`mongorestore`
(the release's `mongodb\bin`, `releaseLayout().mongodump`).

```text
node backup.mjs create --data-root <abs> --mongod <mongod> --tools <dir> --api <release>\api
                       [--kind scheduled|manual] [--reserve-mb <n>]
node backup.mjs verify --data-root <abs> --mongod <mongod> --tools <dir> --api <api>
                       [--backup <id> | --from <exported backup dir>]
node backup.mjs export --data-root <abs> --to <drive folder> [--backup <id>]
node backup.mjs prune  --data-root <abs>
node backup.mjs status --data-root <abs>
node restore.mjs --data-root <abs> --from <backup dir> --confirm <backup id>
                 --mongod <mongod> --tools <dir> --api <api>
                 [--accept-open-shifts] [--accept-newer-sales] [--accept-pending-offline]
```

Exit codes: 0 done, 1 failed (recorded in `status.json`), 2 usage, 3 refused
(nothing changed). Output is JSON plus progress lines; it never contains
secrets or connection strings (tool output is redacted, and printed only with
`GPOS_BACKUP_DEBUG=1`). Backup, export, prune and restore share one lock
(`state\backup.lock`); a second run is refused, a dead run's lock is taken
over.

## Consistency

`create` runs `mongodump --oplog --gzip --archive` against the replica-set
primary (`gpos_root`, credential passed in a 0600 tool config file, never on
the command line). `--oplog` also copies the oplog written while the dump
ran, and `mongorestore --oplogReplay` replays it, so a restore yields the
single point in time at which the dump finished, with each multi-document
transaction applied whole. This is MongoDB's supported online method for a
replica set without filesystem snapshots; copying `database\` while mongod
runs is never done. A filesystem (VSS) snapshot would need a Windows-specific
component and still journal recovery; stopping the service for a cold copy
would interrupt the store daily. mongorestore refuses namespace filters with
`--oplogReplay`, so the archive restores whole: `grocery`, the
`gpos_runtime` installation marker and the two database users (SCRAM hashes).

Proved under load: a writer commits transactions inserting the same id
into two collections throughout `create`; the test restore and a real
restore hold equal sets forming a contiguous prefix (no half transaction, no
gap).

## Verification and status

A backup is written under `backups\.incomplete-<id>\` and only renamed to
`backups\<id>\` after every check passed:

1. `mongodump` exited 0; the backup files are copied; `manifest.json` lists
   every file's size and SHA-256 and `manifest.sha256` checksums it.
2. Checksums are re-read, then the archive is restored into a throwaway
   standalone mongod (owner-only scratch folder, free loopback port,
   `--oplogReplay`). It runs with `--auth`: its only user, created through
   the localhost exception as it starts, has a random password kept in the
   scratch folder and memory, so other local accounts cannot read the copy.
   The installation marker must match, every `grocery` collection must pass
   `validate`, and per-collection counts go into `verification.json`.

A failed or killed run leaves no backup-named folder; the next run stops
any test mongod it left (only after it reports that scratch dbPath) and
removes the leftovers.

`backups\status.json` (`STATUS_SCHEMA` 1) is the interface #365 reads:

| Field                 | Meaning                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lastAttempt`         | `{at, command, backupId?}` written before work starts                                                                                                                                                                                                                                                                                                                   |
| `lastSuccess`         | `{at, command, backupId, kind?}` last completed `create` or `export`                                                                                                                                                                                                                                                                                                    |
| `lastVerifiedSuccess` | `{at, backupId, kind, createdAt}` last backup that passed the test restore (create or verify)                                                                                                                                                                                                                                                                           |
| `lastFailure`         | `{at, command, code, message, backupId?}`; codes `DESTINATION_UNAVAILABLE`, `DESTINATION_SAME_DISK`, `LOW_DISK`, `DATABASE_UNAVAILABLE`, `TOOLS_UNAVAILABLE`, `DUMP_FAILED`, `VERIFY_FAILED`, `BACKUP_CORRUPT`, `BACKUP_UNVERIFIED`, `NO_VERIFIED_BACKUP`, `EXPORT_FAILED`, `DESTINATION_NOT_REMOVABLE`, `DESTINATION_UNKNOWN_MEDIA`, `STATUS_CORRUPT`, `BACKUP_FAILED` |
| `consecutiveFailures` | reset by a success                                                                                                                                                                                                                                                                                                                                                      |
| `lastExport`          | `{at, backupId, destination}`                                                                                                                                                                                                                                                                                                                                           |
| `lastRestore`         | `{at, backupId, safetyBackupId}`                                                                                                                                                                                                                                                                                                                                        |

`backup.mjs status` adds `backupOverdue` (no verified backup for 36 h),
`exportReminderDue` (no export for 7 days) and the backups on disk, each
`verified` only when its manifest checksum and verification record agree.
Nothing infers success from a folder or file existing. An unreadable
`status.json` makes `status` fail (exit 3); the next command that records
status keeps the damaged file as `status.corrupt-<time>.json` and starts
again with a `STATUS_CORRUPT` failure naming it, never a silent reset.

## Contents and secrets

Included (`files\…` in the backup): `secrets\mongo-keyfile`,
`mongo-root-password`, `mongo-api-password`, `jwt-secret`,
`state\install.json`, `config\runtime.json`. Without them the database is
unreachable (#360 has no reset path), and the JWT secret signs offline cost
evidence and leases (#37), so a replacement PC needs them.

`cookie-secret` is not included: it signs the session cookies only (the API
accepts access tokens solely from cookies it signs), and every restore
writes a new one, so no pre-restore access or refresh token works afterwards.

Excluded, with reasons in each manifest: `secrets\api.env` and
`config\mongod.cfg` (derived, rewritten for the target paths), `tls\` (the
local CA is trusted per machine; the replacement's installer creates and
trusts its own, #358/#362), `logs\`, the live `database\` files, the
`local` database, and browser storage (below).

Local backups sit in `backups\` (owner-only; SYSTEM/Administrators on
Windows). Exports are plaintext by owner decision: whoever holds the drive
can read the store's data and these secrets. Keep export drives physically
secured like the cash drawer key. Encryption bound to the failed PC (DPAPI,
TPM) could not be restored on a replacement and is not used.

## Retention

After each successful `create` (and with `prune`), verified backups older
than 30 days are removed, except the newest verified backup, which is kept
however old: pruning can never leave the installation without a verified
backup. Unverified folders are never pruned as backups; exports are never
touched. A restore never prunes: its pre-restore safety backup skips
retention, so the backup being restored (possibly the oldest) stays; the
next ordinary `create` applies retention as usual.

## Export

`export` copies the newest (or `--backup`) verified backup to
`<to>\GroceryPOS-backup-<id>\`, re-checks every checksum at the destination
and only then names it. A missing or unwritable destination or a full
drive fails visibly. Exports go to **removable media only** (owner
decision): the destination's volume must be on a USB, SD/MMC or FireWire
disk (or report a Removable drive type) that is neither the installation's
disk nor a boot/system disk. On Windows the tool asks PowerShell's Storage
module (`Get-Volume -FilePath` → `Get-Partition` → `Get-Disk`), which
follows drive letters, folder-mounted volumes and `subst` drives to the real
disk; external USB hard disks that report a Fixed drive type are accepted
by their bus. On Linux it reads `/sys/dev/block` (`removable` flag or a USB
path). A second internal disk, the installation's disk, or anything that
cannot be identified is refused (`DESTINATION_NOT_REMOVABLE`,
`DESTINATION_UNKNOWN_MEDIA`, `DESTINATION_SAME_DISK`).
`--test-allow-fixed-destination` exists for test harnesses only (CI has no
removable drive); the installer never exposes it. `verify --from <export>`
re-runs the test restore on an exported copy.

## Restore

`restore.mjs` is the protected maintenance tool (administrator only, not
linked from the app). Before anything changes it:

1. checks the backup's checksums and verification record (corrupt, partial
   or unverified backups are refused);
2. requires `--confirm <backup id>` exactly;
3. checks compatibility: same MongoDB major.minor, app version no older than
   the backup's (newer data is never opened by an older app);
4. refuses while the API listens (stop `GroceryPOS-Proxy` and
   `GroceryPOS-API`; MongoDB may run or is started by the tool);
5. on an existing installation: same installation id and identical secrets,
   then refuses each kind of loss unless accepted on its own flag: open
   shifts (`--accept-open-shifts`), active offline cash leases, which mean a
   terminal may hold unsynchronized cash receipts (`--accept-pending-offline`),
   and sales recorded after the backup (`--accept-newer-sales`);
6. takes and verifies a `pre-restore` safety backup of the current data.

It then drops the `grocery` database, restores the users, then the whole
archive with `--oplogReplay`, checks every collection's count against the
verification record and the installation marker, and writes an
allowlisted `SYSTEM.DATABASE_RESTORED` audit entry into the restored
database (so it survives the restore; actor none; backup id and time,
safety backup id, replacement installation or not, which `--accept-*`
overrides were used, source; never secrets or paths). It then ends every
session: `refreshtokens`, `stepups` and `overridegrants` are emptied and a
new cookie secret is written to `secrets\cookie-secret` and `api.env`, so
pre-restore access tokens stop working immediately and everyone logs in
again. The JWT secret is kept, so signed offline evidence stays valid.

**Offline cash after a restore needs an ADMIN.** Offline leases are kept,
but their sessions are gone, so a terminal's queued cash sale is refused
with "needs admin reconciliation" (`OFFLINE_RECONCILIATION_REQUIRED`) even
after the cashier logs in again; an ADMIN reconciles it on that terminal
with a reason (#37). It stays saved on the terminal until then. `state\restore.json` journals the
run; an interrupted restore must be finished by re-running the same restore
(other restores are refused until then).

### Replacement PC

1. Install the same or a newer release on the replacement (#362), without
   provisioning the data root, or point `--data-root` at an empty folder.
2. Run `restore.mjs --from <drive>\GroceryPOS-backup-<id> --confirm <id> …`.
   On an empty data root it places the backup's identity and secrets,
   provisions (#360), and restores. The store's users and passwords come
   back with the data.
3. Register/start the services (#362). The new local CA must be trusted on
   the new PC (installer). Log in; take a backup and an export.

Restored on Linux end-to-end, including the compiled API logging in the
restored first ADMIN.

### Browser data

Parked tickets (localStorage) and queued offline cash (IndexedDB) live in
Chrome on the terminal, not in MongoDB, and are neither backed up nor
cleared by these tools. Before a planned backup/restore: finish or park
sales, let "Offline cash ready" queues upload, close shifts. After a restore
the browser keeps its queue: receipts already accepted by the server before
the backup are replays (same idempotency key) and are not posted twice;
receipts still queued upload only through explicit ADMIN reconciliation on
that terminal (see Restore), never automatically. Cash recorded after the backup and
already deleted from a browser queue cannot be recovered by the tools: count
the drawer and record it manually. A lost PC loses its browser storage too.

## Verification

Portable (`pnpm test:single-pc-proof`): retention never removing the only
verified backup, removable-media classification (Windows facts incl.
subst/folder mounts onto the installation disk, USB disks reporting Fixed;
Linux sysfs), corrupt `status.json` kept aside, status/overdue/reminder rules, strict arguments, loss
refusals, contents list, checksum/unexpected-file corruption, status never
trusting folder names, and the Database Tools pin.

Real MongoDB (CI's `db` job extracts `mongod`, `mongodump` and
`mongorestore` from `mongo:7.0.48` and fails unless its tools are the
pinned `mongodbTools.version`, 100.20.1):

```bash
GPOS_TEST_MONGOD=/path/to/mongod GPOS_TEST_MONGO_TOOLS=/dir/with/tools pnpm test:single-pc-backup
```

It provisions an installation, bootstraps the first ADMIN through the
compiled API (when built), seeds users, sales, sale details, shifts,
inventory, batches, ledger, audit, settings, offline cost evidence and
leases, then: backup under concurrent transactions, export (missing drive and
same disk refused), corrupt/truncated/manifest-less/missing-key/incompatible
MongoDB/newer-app refusals with the data unchanged, low disk, runs killed
while dumping and while test-restoring (not successes; next run cleans and
stops the orphan mongod), in-place restore refused for each loss then
accepted with a verified safety backup, the audit entry, a rotated cookie
secret (a pre-restore login's cookie gets 401) and the JWT secret kept, a
backup older than 30 days restored without being pruned, and a
replacement-PC restore onto an empty root with identical domain data and an
ADMIN login.

### Windows-only proof (not yet done)

The release's `mongodump.exe`/`mongorestore.exe` (components.json
`mongodbTools`), Task Scheduler execution as SYSTEM (#362), ACLs on
`backups\` and exports, NTFS rename/lock behaviour, the PowerShell removable-media check (USB stick, USB hard disk, SD card, second internal disk, folder mount, `subst`), an external USB drive's
device check, Windows paths in tool config files, and measured backup/restore
time on the 4 GB qualification machine (#357/#366).
