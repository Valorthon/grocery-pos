# Maintenance and upgrade procedure (single-PC edition)

For the vendor during the agreed maintenance period, and for the owner's
daily routine. Upgrades are manual and offline (owner decisions #357: no
automatic updates; all shifts closed and pending receipts synchronized
first; a 30-minute maintenance window target). Tool details:
[../upgrade/README.md](../upgrade/README.md).

**Status:** not yet performed on Windows 11 (RUNBOOK B8–B10, C7). The
30-minute target has not been measured on a realistic database.

## Daily startup and shutdown (owner)

- **Start:** switch the PC on. The Grocery POS services start by themselves,
  before anyone logs in to Windows. Double-click **Grocery POS**; it waits
  until the app is ready (up to 3 minutes after a power cut) and opens
  Chrome.
- **During the day:** keep the PC on and plugged in; do not clear Chrome's
  browsing data (it holds parked tickets and queued offline cash sales).
- **End of day:** every cashier closes their shift. Leave the PC on if you
  can, so the 22:00 backup runs; otherwise it runs at the next start.
- **Shut down:** use Windows Start > Power > Shut down, never the power
  button or the plug. The database stops cleanly.

## Before an upgrade

Book the window with the owner (outside opening hours). Then, in order:

1. **Build and verify** the new bundle on the vendor machine
   (`bundle.mjs`, then `readiness.mjs --bundle … --manifest-sha256 …`) and
   record its manifest hash out of band, as for an install.
2. **Shifts closed:** every cashier closes their shift (the upgrade refuses
   open shifts).
3. **Pending receipts synced:** on every register, no queued offline cash
   sale remains ("Offline cash" shows nothing pending; closing a shift
   already requires the queue to drain).
4. **A verified backup** from the last 36 hours: "Check Grocery POS" shows
   Backups OK (the upgrade refuses otherwise and also takes its own
   pre-upgrade backup).
5. **Close every Grocery POS tab in Chrome** on the PC and on every LAN
   terminal (#399), after each terminal shows no pending offline cash.
6. Note the time: the window starts now.

## Upgrade

From the new bundle folder, in an elevated Windows PowerShell:

```powershell
(Get-FileHash .\bundle-manifest.json).Hash        # equals the recorded hash
powershell -ExecutionPolicy Bypass -File .\Install.ps1 -ManifestSha256 <hash> -Mode upgrade
powershell -ExecutionPolicy Bypass -File .\Install.ps1 -ManifestSha256 <hash> -Mode upgrade-status
```

`upgrade-status` prints the stages, the pre-upgrade backup id, the
migrations applied and the timings (`timings.total` in milliseconds). Then
open **Grocery POS**, log in, check a product and the last sale, and run
**Check Grocery POS**. Note the time: the window ends now.

## Measuring the 30-minute window

Record, per upgrade: (a) the time from step 6 above to a working login
after the upgrade, and (b) `timings.total` from `upgrade-status`. The
acceptance harness's `upgrade-window` check reads (b) from
`state\upgrade.json` and fails above 30 minutes. If (a) exceeds 30 minutes,
report it with the database size (`Check Grocery POS` → Disk/Database) so
the target can be revisited with the owner.

## If the upgrade stops

Follow RECOVERY.md "After an interrupted or failed upgrade": re-run
`-Mode upgrade` (it resumes), or, if the status says a restore is required,
`-Mode upgrade-rollback -RestoreBackup <pre-upgrade backup id>`. Never start
the services by hand while an upgrade is unfinished.

## After the upgrade

- A Chrome tab that was left open shows "Grocery POS was updated": press
  Reload; the basket and queued cash sales are kept.
- Make a backup and a USB export.
- `releases\` keeps the current and the previous release (for rollback).

## Other routine maintenance (vendor)

- Repair (services, shortcuts, certificate trust) without changing the
  version: `-Mode repair` with the installed version's bundle.
- Large database log: `diagnose.mjs rotate-logs` (the nightly task does
  this at 22:30).
- MongoDB series changes (7.0 → 8.0) are refused by the upgrade tool; they
  need a separate plan.
