# Single-PC upgrades (#364)

The vendor upgrades an installed Grocery POS by hand, offline, during an
agreed maintenance window (owner decisions: no automatic updates, no
internet dependency, all shifts closed and pending receipts synchronized
first, a 30-minute window target). One business codebase: cloud and
staging are unchanged.

## Procedure (vendor)

1. Build the new bundle (`installer/bundle.mjs`) and record the printed
   `bundle-manifest.json` SHA-256 out of band, exactly as for an install.
2. With the owner: every cashier closes their shift; every register shows
   no pending offline cash sales (closing a shift already requires it).
3. On the PC, elevated, from the new bundle folder:

    ```powershell
    .\Install.ps1 -ManifestSha256 <hash> -Mode upgrade
    ```

    Install.ps1 verifies the manifest hash and the tools it runs (as for an
    install) and runs `tools\upgrade\upgrade.mjs upgrade` from its verified
    copy. The tool verifies every release file again.

4. `-Mode upgrade-status` prints the journal (`state\upgrade.json`):
   stages done, the pre-upgrade backup id, migrations applied, timings.

Browsers: close every Grocery POS tab in Chrome, on this PC and on every
LAN terminal (#399), before step 3 (after the registers show no pending
offline cash; a terminal's queued cash lives only in its own Chrome), and open it again with the
shortcut afterwards. A tab left open gets the reload dialog (see "Stale
browser tabs").

## What the tool does

| Stage       | What happens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify`    | `readBundle` (installer): manifest hash pin, every release file. The tool's own migration registry must be the one the manifest lists.                                                                                                                                                                                                                                                                                                                                                                                    |
| `preflight` | Read-only refusals (exit 3, nothing changed): not completely installed; unfinished restore; same version; older app or data version (no downgrades); data older than the bundle's upgrade floor; another MongoDB release series (major.minor) or FCV not matching; data-version marker not `ready` or not the installed release's; open shifts; active offline leases; no verified backup, overdue (36 h) or last backup failed; free disk below 1.2 × the release (program volume) or the installer's 5 GB data minimum. |
| `stop`      | API and proxy services set to manual start and stopped (MongoDB keeps running); shifts and leases re-checked, else restarted and refused.                                                                                                                                                                                                                                                                                                                                                                                 |
| `backup`    | `backup.mjs createBackup` with the installed release's binaries, kind `pre-upgrade` (verified by a test restore, never pruned by this run).                                                                                                                                                                                                                                                                                                                                                                               |
| `place`     | `placeRelease` (installer): copied beside the current one under `releases\<version>`, verified, renamed into place.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `migrate`   | Pending registry migrations, in order, with root credentials and the API stopped. The marker `grocery.systemdataversion` goes `migrating` first and `ready` at the new version last; each migration is recorded in `grocery.systemmigrations`. Both live in the app database, so a restore of the pre-upgrade backup takes them back with the data.                                                                                                                                                                       |
| `switch`    | The installer's repair with the verified bundle: services re-registered on the new release (automatic start again), provisioning, tasks and shortcuts, old releases pruned to current + previous.                                                                                                                                                                                                                                                                                                                         |
| `ready`     | `diagnose.mjs` checks `versions`, `services`, `database`, `api`, `proxy` until all OK (180 s).                                                                                                                                                                                                                                                                                                                                                                                                                            |

The API itself refuses to start in single-pc unless the marker is `ready`
at exactly its `SINGLE_PC_DATA_VERSION` (contracts; an absent marker is
version 1). So an old release never runs on migrated data, and a new one
never runs before its migrations, whatever the services do (for example
after a reboot mid-upgrade).

## Interruption and failure

Every stage is idempotent and journaled before and after. After a power
cut or kill, re-run the same `-Mode upgrade`: it resumes at the
interrupted stage (an interrupted migration re-runs from its start, which
the registry contract requires to converge). A different bundle is
refused until the unfinished upgrade is finished or rolled back.

| Failure                                                       | What happens                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before a data-changing migration started (or none needed one) | Automatic binary rollback: the previous release (re-verified against the hashes recorded at preflight) is re-registered and started; journal `rolled-back`. No data was changed.                                                                                                                                                                                                                                                                                       |
| After a data-changing migration started                       | Nothing automatic. API and proxy stay stopped (manual start; the API's gate refuses anyway); journal `needs-recovery`. Either re-run the upgrade to finish it, or `-Mode upgrade-rollback -RestoreBackup <id>` (the journal's pre-upgrade backup id, typed as confirmation), which runs `restore.mjs` (safety backup first; refuses open shifts, active leases and sales recorded after the backup unless accepted: `-AcceptNewerSales`) and then the binary rollback. |
| The rollback itself fails                                     | Journal `rollback-failed`; run `-Mode upgrade-rollback` again.                                                                                                                                                                                                                                                                                                                                                                                                         |

Binary rollback is not schema recovery: the tool never starts the previous
release on data a migration may have changed, and never restores over later
sales without `-AcceptNewerSales`. A restore ends every session (#363).

## Data migrations

`migrations.mjs` holds the registry and `DATA_VERSION` (pinned equal to
contracts' `SINGLE_PC_DATA_VERSION`), now at version 2. Its one entry,
`uppercase-product-names` (1 → 2, #443), uppercases every product name;
its read-only `check(db)` runs in `preflight`, so names that would collide
after uppercasing (or grow past 50 characters) refuse the upgrade before
anything changes: rename them in the installed release and re-run. The
cloud's legacy backfills (`migrate:categories`, `migrate:stock-ledger`,
`migrate:decode-entities`) are recorded as not applicable: every single-PC
database was created at version 1 by #360 provisioning and the current
API, so their legacy inputs cannot exist there. New installations are
stamped with the installing release's data version.

`DATA_CHECKS` run in every upgrade's preflight, whatever the data
version, and only read: `product-name-characters` (#483) refuses product
names with emoji or other disallowed characters, listing them, so the
owner renames them in the current release first. No data version bump.

A schema change that needs a migration bumps both versions and adds an
entry (`id`, `from`, `to = from + 1`, `changesData`, `up(db, { log })`)
that is idempotent, offline and uses only the release (its node and the
API's `node_modules`), plus an optional read-only `check(db)` returning
refusal strings for `preflight`. The bundle manifest's `data` block
(`dataVersion`, `minUpgradeFromDataVersion`, `migrations`,
`legacyMigrationsNotApplicable`) records it.

## Stale browser tabs

A tab left open across an upgrade keeps the previous release's code in
memory. The single-pc client sends contracts' `WIRE_VERSION` in
`x-wire-version` on every API request, refresh included. The single-pc API
refuses any other value, a duplicated header or none at all (no single-pc
installation predates #364) with 409 `CLIENT_OUTDATED` before reading the
body; only health probes and the browser's CSP reports are exempt. The
client then shows a dialog (owner decision 2026-11-15): "Grocery POS was
updated" / "Reload to continue." with a single Reload button (no Cancel,
Escape does nothing). The reload keeps the basket (localStorage) and every
queued offline cash sale (IndexedDB): the outbox treats `CLIENT_OUTDATED`
as retry-later, never blocked or deleted, and the reloaded page uploads it
once. Navigation is network-first in the service worker, so a reload gets
the new `index.html`; the new worker replaces the old shell cache when it
activates. A release that changes the wire contract incompatibly bumps
`WIRE_VERSION`. The cloud client sends no new header. Closing tabs before
an upgrade is still the procedure (checklist B9/B10).

## Restoring a backup after an upgrade

Backups record their data version (`versions.data`; none recorded means 1).
`restore.mjs` refuses a backup with newer data than the release restoring
it, one taken while an upgrade was migrating, or one below the release's
upgrade floor. A backup with older data is restored and then taken forward
with the release's own migrations (the same runner and records as an
upgrade), so its API can start; the restore summary lists them. An upgrade
rollback (`--restore-backup`) restores to the previous release's version
and never migrates.

## The previous release

Every install, repair and upgrade records the placed release's verified
manifest in `state\releases\<version>.json`. Preflight refuses an upgrade
when the installed release does not match its record, and a rollback
re-verifies the previous release against it before touching any service:
if it changed (a stray file, an antivirus quarantine), the rollback is
refused and the release is left where it is (never moved aside; there is
no copy to restore it from). Fix it (repair from its own bundle) or finish
the upgrade.

## Verification

Portable (`pnpm test:single-pc-proof`, `upgrade.test.mjs`): registry rules,
every preflight refusal, recovery plan, arguments, the manifest's data block
and shipped tools, repair refusing another version, Install.ps1 modes
(static).

Also: a damaged installed release refused at preflight, damaged during an
upgrade with the rollback refusing and leaving it in place, then rolled
back once fixed; an older-data backup restored after an upgrade and
migrated forward (its API starts), and a newer-data backup refused.

Real MongoDB on Linux (`pnpm test:single-pc-upgrade`, needs
`GPOS_TEST_MONGOD`, `GPOS_TEST_MONGO_TOOLS` and a built API): a populated
installation of release A upgraded to B with a data migration (verified
backup, migration applied once, switched, ready, previous release kept,
secrets unchanged, rerun refused unchanged); every refusal leaves data,
services and version untouched (open shift, offline lease, overdue and
failed backup, downgrade, MongoDB 8.0 bundle, low disk, wrong hash,
tampered file, foreign tool); a cut before and after every stage and in
the middle of the migration, each resumed; a real `SIGKILL` of the
upgrade process mid-migration, with the previous release's API refusing
the half-migrated data, then resumed; a failed migration that needs
`--restore-backup`, refuses a later sale until accepted, then restores and
runs the previous release; automatic binary rollback when the copy fails
and when the new API never becomes ready; and the real compiled API
refusing another data version. Services are simulated by processes and
pid files (`fixture.test.mjs`); measured on Linux the whole upgrade of the
small test database took about 5 s (switch 3.4 s, backup 1 s).

### Windows-only proof (not yet done, #357/#366)

`Install.ps1 -Mode upgrade|upgrade-rollback|upgrade-status` parse and run;
`sc config start= demand|auto` and the real service stop/start order;
MongoDB/WinSW graceful stops; the duration with a realistic database
against the 30-minute target; power loss at each stage on NTFS; a Chrome
tab and service worker kept open across the upgrade (checklist B9) and
queued offline receipts across it (B10); a populated earlier package (B8).
