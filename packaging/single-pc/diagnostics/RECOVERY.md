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
  check --data-root "%ProgramData%\Valorthon\GroceryPOS" ^
  --release "%ProgramFiles%\Valorthon\GroceryPOS\releases\<version>"
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
   then the browser address) and retry every minute. Nobody needs to log in
   again: sessions last 7 days from login and survive restarts.
2. Wait 5 minutes after the restart; a database recovering from a power cut
   can take that long. Run the check again.
3. If a service is "STOPPED": open Services (`services.msc`), right-click
   `GroceryPOS-MongoDB` (then `GroceryPOS-API`, then `GroceryPOS-Proxy`,
   then `GroceryPOS-ProxyLan` if this PC serves LAN terminals) and choose
   Start.
4. "Application is running but cannot use the database": the database is down
   or the application cannot sign in to it. Fix the database first. If the
   database is OK and this persists, call the vendor (repair, below).
5. "Not installed" or still failing: the vendor runs the installer in
   **repair** mode from the bundle (installer README "Repair"). Repair keeps
   the data.
6. Disk full is a common cause: check **Disk space**.
7. If **Database** says "the processor may not support AVX", this PC's
   processor may be too old for the database (it needs AVX). Restarting will
   not help: call the vendor.

Vendor: service logs are in `logs\api\` and `logs\proxy\`, the database's in
`logs\mongod.log`. The check prints their last errors with secrets removed.

Vendor, stopping and starting the API by hand (elevated PowerShell): the
proxy depends on the API, so stopping the API without `-Force` refuses
("has dependent services"). Use `Stop-Service GroceryPOS-API -Force`, which
also stops the proxy (and `GroceryPOS-ProxyLan` when a LAN IP is set). The
proxy does not come back by itself, so start them all again:
`Start-Service GroceryPOS-API, GroceryPOS-Proxy`, plus
`Start-Service GroceryPOS-ProxyLan` when a LAN IP is set.

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
22:00. The backup runs at the next start; leave the PC on, or plug in the backup
USB drive and make a manual backup now with **Back up to USB drive**
(labelled `manual`; without a drive it stops with "No USB drive was found"
and makes no backup). Running the daily task by hand from an administrator
Command Prompt (`schtasks /Run /TN "\GroceryPOS\Daily backup"`, it runs as
SYSTEM) also works and is labelled `scheduled`. There is no "Back up now" button in the
app: by design the app can't read the secrets or run the backup tool.

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

**The backup drive holds the store's keys** (the database passwords, the
sign-in secret and the local HTTPS root key). Keep it like a
key: locked away, never shared or lent. If a backup drive is lost or stolen,
tell your vendor at once.

## Certificate or address problems

Signs: Chrome shows "Your connection is not private" on
`https://localhost:1443`; the check shows **Browser address** FAIL or WARN.

1. Type exactly `https://localhost:1443` (not `127.0.0.1`, not `http://`,
   no other port). Use the "Grocery POS" shortcut.
2. Restart the PC (the browser address service may not have started).
3. If the warning persists, do not continue past it. The vendor runs
   **repair**, which trusts the local certificate again.
4. Other PCs on the network cannot use this address (`localhost` is each
   PC itself).
   LAN terminals use this PC's fixed LAN address instead (next section).

## LAN terminals cannot connect

Signs: the other tills cannot open Grocery POS, while this PC still can;
the check shows **LAN terminals** WARN.

1. Keep selling on this PC: its own register does not depend on the
   network. Terminals with offline cash ready can keep taking cash.
2. Check the network cable or Wi-Fi of this PC and that the router or
   switch is on. This PC must have its fixed LAN address back; the LAN
   service (GroceryPOS-ProxyLan) retries by itself within a minute.
3. Still down once the network is back: restart the PC. If the check then
   shows **LAN terminals** FAIL ("not installed"), the vendor runs
   **repair**.
4. **LAN network** WARN names the cause: the fixed address is gone (next
   section), the network is Public (set it to Private in Windows Settings >
   Network & internet), the firewall rule is missing (vendor **repair**), the
   LAN proxy service (GroceryPOS-ProxyLan) is stopped or not answering
   (restart the PC; it also retries by itself) or not installed (vendor
   **repair**), or the certificate on the LAN address does not match
   (restart, else **repair**).

## LAN address changed

Signs: **LAN network** WARN "this PC no longer has" its address, usually
after a router change or a DHCP lease moved (#399).

1. Give this PC its fixed address back (router reservation or static IP);
   nothing else changes and terminals reconnect by themselves.
2. If the address must change, the vendor runs `-Mode repair -LanIp <new
IP>` and joins every terminal again (`JoinTerminal.ps1 -Mode rejoin`).
   A new address is a new browser origin: each terminal's Chrome data for
   the old one (parked tickets, its terminal label, queued offline cash) is
   not carried over. Sync offline cash and finish parked tickets first; an
   ADMIN sets each terminal's label again in Store settings.

## Terminal lost its label or offline cash

Signs: after its Chrome window closed, a LAN terminal asks for its label
again, or offline cash it took is gone from its queue, or the cashier's own
shift close is refused because the terminal's offline queue never drained.

Each terminal must always open the app with the "Grocery POS" shortcut,
which uses Chrome's normal Default profile. A Guest or Incognito window, or
clearing the browsing or site data for the POS address (Ctrl+Shift+Delete,
a "delete site data when Chrome closes" setting, cleaner tools), deletes
the terminal label, parked tickets, the current basket and any offline
cash sales not yet synced. It also gives the PC a new terminal identity: a
shift opened there is bound to the old one, so the cashier sees "Your
shift is open on …" and only an ADMIN force-close ends it.

1. Open the "Grocery POS" shortcut again; an ADMIN sets the label again in
   Store settings on this terminal.
2. If offline cash was lost, or a shift was open on this terminal, the
   shift cannot close normally: an ADMIN force-closes it with the counted
   cash.
3. The lost sales cannot be recovered: the drawer will be over by their
   cash. Note them on paper (time, items, amount) with the Z-read, and
   adjust stock for the items sold if needed.

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

With LAN terminals the main PC is their clock (#398): the shop network has no
internet time, so check the main PC's date and time against a phone once a
week and after a power cut. A terminal follows it by itself (about every
17 minutes to 9 hours); a terminal more than 15 hours off (Windows'
`MaxPosPhaseCorrection`/`MaxNegPhaseCorrection` limit, 54000 s), or one
whose register shows "This terminal's clock is … off the main PC. Ask the
owner to fix its time setting.", needs its date and time set by hand
first, then `JoinTerminal.ps1 -Mode rejoin`.

## Terminal clocks

"Check Grocery POS" warns "This PC is not serving time to the LAN terminals"
when the Windows Time service is stopped or its time server is turned off.
The terminals' clocks then drift and offline cash sales may be refused.
Restart the PC. If the warning stays after a restart, the time server is
turned off: ask your vendor to run repair.

## Clock sync

"Check Grocery POS" warns about **Clock sync** when Set time automatically
is off, the Windows Time service is disabled, or Windows is set to another
time source (such as a domain) that it cannot reach. (A stopped time service
on its own is normal: Windows starts it when needed.) It shows **Clock sync**
as information, not a warning, when Set time automatically is on but Windows
has not reached a time server yet ("Local CMOS Clock" or "Free-running
System Clock"): normal without internet or right after the PC starts; check
again once the internet is back. The clock can drift (on a PC that also
starts another system, by hours), which puts sales on the wrong day and may
refuse offline cash sales. Turn on Set time automatically: Windows Settings

> Time & language > Date & time, switch on "Set time automatically", then
> press "Sync now". Run the check
> again. If it still warns, restart the PC; if it stays, ask your vendor.

## After an interrupted or failed upgrade (vendor)

Grocery POS stays closed until the upgrade is finished or rolled back; that
is on purpose. Do not start the services by hand. Run, as an administrator,
from the new release's bundle folder: `Install.ps1 -ManifestSha256 <hash>
-Mode upgrade-status`. Re-running `-Mode upgrade` resumes it; if the status
says a restore is required, `-Mode upgrade-rollback -RestoreBackup <id>`
restores the pre-upgrade backup and the previous release. See the upgrade
README (#364). Every install, repair, upgrade or handover-done run writes
`state\installer-<UTC time>.log` in the data folder and prints its path
as `Installer log:`; keep it with any failure report. Before an upgrade, close every Grocery POS tab in Chrome. If a page shows
"Grocery POS was updated", press Reload; the basket and queued cash sales
stay on this PC and upload after the reload.

## A restore stopped part-way (vendor)

Signs: after a power cut, crash or closed window during `restore.mjs`, other
restores are refused ("An interrupted restore of … must be finished first")
and the application does not start; the check shows **Application** FAIL. If
the restore stopped while it was taking older backed-up data forward to this
release (its forward migration), the data-version marker stays `migrating`
and the API refuses to start on purpose, so half-migrated data is never used.

1. Do not start the services by hand and do not run a different restore.
2. As an administrator, re-run the same restore: the same
   `Install.ps1 -Mode restore` command with the same `-From` folder, the same
   `-Confirm <backup id>` and the same `-Accept…` flags as the first time. It resumes from its journal (`state\restore.json`), keeps the
   safety backup it already took and finishes the migration.
3. Start the services (or restart the PC), run the check, then make a backup
   and a USB export.

## Checking a USB backup stopped part-way (vendor)

Signs: `Install.ps1 -Mode restore-verify` (or `backup.mjs verify --from`) was
closed, killed or lost power; the next run says
`…\GroceryPOS-Verify already exists` or "Restart the PC, then delete …".

1. If another check is still running, wait for it to finish. The tool never
   stops or removes a previous check: a second run refuses even when the
   existing work folder is still empty.
2. After a killed check, restart the PC (that stops any leftover test
   database), then as an administrator delete
   `C:\ProgramData\Valorthon\GroceryPOS-Verify` and run the check again.
   Never delete `C:\ProgramData\Valorthon\GroceryPOS` itself.
