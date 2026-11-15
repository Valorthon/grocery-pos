# Grocery POS: what to do when something goes wrong

For the store owner and the vendor. Start with **"Check Grocery POS"** on the
desktop or in the Start menu (answer Yes to the administrator prompt for a
full check): it tells you which section applies. This guide is in the Start
menu as **"Grocery POS help"**. "Save support file…" in the check saves a file
for your vendor (no sales data, passwords or names) to a folder you choose.

The vendor can run the same check from a command prompt:

```text
"%ProgramFiles%\Valorthon\GroceryPOS\releases\<version>\node\node.exe" ^
  "%ProgramFiles%\Valorthon\GroceryPOS\releases\<version>\tools\diagnostics\diagnose.mjs" ^
  check --data-root "%ProgramData%\Valorthon\GroceryPOS"
```

Run it from an administrator Command Prompt to see everything. It only
looks; it changes nothing and sends nothing anywhere.

Rules that apply everywhere:

- Never delete, move or edit anything under
  `%ProgramData%\Valorthon\GroceryPOS` (database, secrets, certificates,
  backups). There is no way to recover a deleted database or secret without a
  backup.
- Never click through a Chrome certificate warning on
  `https://localhost:1443`.
- Restoring a backup replaces the data and is done only with the protected
  restore tool, with its confirmation (see
  [../backup/README.md](../backup/README.md) "Restore"). Do not restore to fix
  a problem this guide fixes another way.

## The database or API does not start

Signs: the page says it cannot reach the server; the check shows **Services**,
**Database** or **Application** as FAIL.

1. Restart the PC. The services start by themselves (MongoDB, then the API,
   then the browser address) and retry every minute.
2. Wait 5 minutes after the restart; a database recovering from a power cut
   can take that long. Run the check again.
3. If a service is "STOPPED": open Services (`services.msc`), right-click
   `GroceryPOS-MongoDB` (then `GroceryPOS-API`, then `GroceryPOS-Proxy`) and
   choose Start.
4. "Application is running but cannot use the database": the database is down
   or the application cannot sign in to it. Fix the database first. If the
   database is OK and this persists, call the vendor (repair, below).
5. "Not installed" or still failing: the vendor runs the installer in
   **repair** mode from the bundle (installer README "Repair"). Repair keeps
   the data.
6. Disk full is a common cause: check **Disk space**.

Vendor: service logs are in `logs\api\` and `logs\proxy\`, the database's in
`logs\mongod.log`. The check prints their last errors with secrets removed.

## Disk full

Signs: **Disk space** FAIL or WARN; backups fail with `LOW_DISK`; the
application reports disk pressure.

1. Empty the Recycle Bin; delete personal files you do not need (Downloads,
   videos, old installers).
2. Do not delete anything in the Grocery POS data folder. Old backups are
   removed automatically after 30 days.
3. If the database log is large (the check says so), the vendor runs
   `diagnose.mjs rotate-logs` as administrator.
4. Run the check again; then run a backup (below) if the last one failed.
5. If the disk is simply too small, the vendor plans a larger disk and moves
   the installation with a backup and restore.

## Backup failed

Signs: **Backups** FAIL ("failed [CODE]" or "overdue"). The result always comes
from the backup tool's own status, never from files on disk.

| Code                                                                | What to do                                                          |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `LOW_DISK`                                                          | Free space ("Disk full"), then back up again.                       |
| `DATABASE_UNAVAILABLE`                                              | Fix the database first ("The database or API does not start").      |
| `DUMP_FAILED`, `VERIFY_FAILED`, `BACKUP_CORRUPT`                    | Run a backup again; if it fails twice, call the vendor.             |
| `TOOLS_UNAVAILABLE`                                                 | The installation is incomplete: vendor runs repair.                 |
| `DESTINATION_UNAVAILABLE`, `DESTINATION_SAME_DISK`, `EXPORT_FAILED` | See "USB drive not available".                                      |
| `NO_VERIFIED_BACKUP`                                                | No backup to copy yet: leave the PC on overnight (backup at 22:00). |
| other                                                               | Call the vendor with the code and time shown.                       |

"Overdue" means no verified backup for 36 hours: the PC was probably off at
22:00. The backup runs at the next start; leave the PC on, or the vendor runs
a manual backup (`backup.mjs create --kind manual`, backup README).

## USB drive not available

Signs: "Back up to USB drive" shows no drive or fails; the check shows the
USB reminder.

1. Plug in the USB drive or SD card and wait until Windows shows it.
2. Only removable drives are accepted. An external hard disk that Windows
   reports as a fixed disk, or a second internal disk, is refused on purpose.
3. If the drive is full, copy older `GroceryPOS-backup-…` folders elsewhere
   or use a larger drive (the tool never deletes anything on the drive).
4. Try another USB port or drive. Keep at least one recent copy off the
   premises.

## Certificate or address problems

Signs: Chrome shows "Your connection is not private" on
`https://localhost:1443`; the check shows **Browser address** FAIL or WARN.

1. Type exactly `https://localhost:1443` (not `127.0.0.1`, not `http://`,
   no other port). Use the "Grocery POS" shortcut.
2. Restart the PC (the browser address service may not have started).
3. If the warning persists, do not continue past it. The vendor runs
   **repair**, which trusts the local certificate again.
4. Other PCs on the network cannot use this address; that is by design (no
   LAN access).

## Interrupted shutdown or power loss

Signs: after a power cut or forced shutdown the app does not come back;
**Database** says "running but not ready".

1. Let the PC start normally and wait 5 minutes: MongoDB recovers its journal
   by itself.
2. Run the check. If the database is ready but the application still fails,
   restart the PC once more.
3. Do not delete `mongod.lock` or anything in the database folder.
4. If the database never becomes ready, call the vendor. If the database is
   damaged, the vendor restores the newest verified backup with the protected
   restore tool (sales after that backup are lost; the tool shows how many).
5. Sales made while offline stay queued in the browser and synchronize when
   the app is back; do not clear the browser's data.
6. A UPS (battery backup) avoids most of these.

## Clock wrong

Signs: **Clock** FAIL. Set the date and time in Windows Settings > Time &
language (turn on "Set time automatically" if the PC is online), then restart
the PC. Do not sell while the clock is wrong: sales would land on the wrong
day.

## After an interrupted or failed upgrade (vendor)

Grocery POS stays closed until the upgrade is finished or rolled back; that
is on purpose. Do not start the services by hand. Run, as an administrator,
from the new release's bundle folder: `Install.ps1 -ManifestSha256 <hash>
-Mode upgrade-status`. Re-running `-Mode upgrade` resumes it; if the status
says a restore is required, `-Mode upgrade-rollback -RestoreBackup <id>`
restores the pre-upgrade backup and the previous release. See the upgrade
README (#364). Before an upgrade, close every Grocery POS tab in Chrome. If a page shows
"Grocery POS was updated", press Reload; the basket and queued cash sales
stay on this PC and upload after the reload.
