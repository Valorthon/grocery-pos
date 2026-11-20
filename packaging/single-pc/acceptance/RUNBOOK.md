# Windows 11 x64 acceptance runbook (#357, #366)

The one executable runbook for accepting a single-PC release on the target.
It replaces [../proof/ACCEPTANCE-CHECKLIST.md](../proof/ACCEPTANCE-CHECKLIST.md)
and keeps that file's numbering: **A1–A6 and B1–B17 are unchanged**. The new
**C1–C8** collect the Windows-only items that #358–#365 left open, and **R1**
is the release check done before anything is installed. **D1–D13** accept
LAN terminals on two-PC hardware (#401, epic #402): a main PC plus at least
one Windows terminal joined to it.

**Not yet executed.** No Windows 11 x64 machine has been available (owner,
2026-11-14). Every field is blank on purpose. Copy this file per run, fill the
copy, keep it with the evidence files outside the repository, and never
record a result that was not observed on the target. A blank or failed item
keeps the issue it closes open. `readiness.mjs` refuses a committed runbook
with a recorded result.

Fields marked `____` are filled by the operator. Each scenario names the
shipped tool to use, the expected result, the evidence to keep and the issue
it closes. Scenarios marked **[harness]** have an automated read-only part in
[acceptance.mjs](acceptance.mjs) (see "Harness" below); the rest are manual.

No scenario here may run against a customer's PC or customer data
(owner, 2026-11-14): use a vendor-owned test PC and test records only.

## Index

| Id  | Scenario                                            | Closes                | Harness |
| --- | --------------------------------------------------- | --------------------- | ------- |
| R1  | Release bundle verified before install              | #366                  | yes     |
| A1  | Target eligibility (CPU, OS, storage)               | #357                  | yes     |
| A2  | Component qualification                             | #357                  | partly  |
| A3  | Compiled-runtime proof (`proof/run.mjs`)            | #357                  | no      |
| A4  | Native password verification                        | #357                  | no      |
| A5  | Authenticated MongoDB transactions                  | #357                  | no      |
| A6  | Hardware measurements (4 GB target)                 | #357                  | no      |
| B1  | Clean install, first ADMIN, forced change           | #366, #361, #362      | partly  |
| B2  | Reboot before Windows logon                         | #366, #360, #362      | partly  |
| B3  | Internet off, local API reachable                   | #366, #359            | no      |
| B4  | Real API outage and recovery                        | #366, #359            | no      |
| B5  | Authenticated transactions on the installed DB      | #366                  | no      |
| B6  | LAN refusal                                         | #366, #358, #393–#396 | partly  |
| B7  | Replacement-PC restore                              | #366, #363            | partly  |
| B8  | Populated and interrupted upgrade                   | #366, #364            | partly  |
| B9  | Stale browser assets                                | #366, #364            | no      |
| B10 | Pending receipt preservation                        | #366, #364, #363      | no      |
| B11 | Crash and power-cut recovery                        | #366, #360, #362      | no      |
| B12 | Repair, uninstall, reinstall                        | #366, #362            | no      |
| B13 | Local HTTPS origin without warning                  | #366, #358, #362      | partly  |
| B14 | Workload on the 4 GB PC                             | #366, #357            | no      |
| B15 | Documentation followed as written                   | #366                  | no      |
| B16 | Installer ACLs                                      | #362, #360, #361      | yes     |
| B17 | Back up to USB drive                                | #362, #363            | no      |
| C1  | Browser auth flows at the installed origin          | #358                  | no      |
| C2  | Service registration, accounts, env and TLS state   | #360, #362            | yes     |
| C3  | Listener binds                                      | #358, #360, #396      | yes     |
| C4  | Scheduled tasks, Windows backup tools, media checks | #362, #363            | partly  |
| C5  | Failure exercises                                   | #365                  | partly  |
| C6  | Owner tools: Check, help, standard user             | #365                  | partly  |
| C7  | Upgrade modes and the 30-minute window              | #364                  | partly  |
| C8  | Preflight refusals and stop timing                  | #362                  | no      |
| D1  | LAN site service, firewall and shared root          | #401, #396            | partly  |
| D2  | Join, rejoin and leave a Windows terminal           | #401, #397            | no      |
| D3  | Concurrent sales on two terminals                   | #401, #395            | no      |
| D4  | Cable pull mid-shift, offline cash and sync         | #401, #359, #37       | no      |
| D5  | Upgrade with a stale terminal tab                   | #401, #364            | no      |
| D6  | Restore logs every terminal out                     | #401, #363            | no      |
| D7  | Replacement PC, then rejoin                         | #401, #363, #396      | no      |
| D8  | LAN IP change                                       | #401, #396, #397      | no      |
| D9  | Terminal clock ±5 min and ±3 h                      | #401, #398            | no      |
| D10 | Time server (NTP) rule and `timeServer` check       | #401, #398            | no      |
| D11 | Caddy leaf renewal: "not yet valid" watch           | #401, #398            | no      |
| D12 | `lanNetwork` and `lanProxy` diagnostics             | #401, #399, #396      | no      |
| D13 | Terminal label before a shift                       | #401, #399            | no      |

## 0. Run record

| Field                                         | Value  |
| --------------------------------------------- | ------ |
| Operator / date (store timezone)              | `____` |
| Source commit (full 40 characters)            | `____` |
| Bundle version and `bundle-manifest.json` SHA | `____` |
| Windows edition, version, build (`winver`)    | `____` |
| CPU model, vendor (Intel/AMD), cores          | `____` |
| Installed RAM (GB), type                      | `____` |
| Storage type (HDD/SATA SSD/NVMe), free GB     | `____` |
| Physical PC or VM (vCPUs, RAM, security)      | `____` |
| Chrome version (`chrome://version`)           | `____` |
| Joined Windows terminal (B6, D1–D13)          | `____` |
| Device on another subnet (for B6)             | `____` |
| Main PC LAN IP (and the D8 replacement IP)    | `____` |
| Two USB drives, one SD card (for B17/C4)      | `____` |
| Evidence folder path                          | `____` |

## Harness

On the target, after B1, copy the source's `packaging\single-pc\` folder
into an **admin-only** folder (for example
`C:\Program Files\Valorthon\GroceryPOS-Acceptance\`, which standard users
cannot write; never run it elevated from a USB stick, Downloads or the
Desktop), compare `Get-FileHash` of `acceptance\acceptance.mjs` with the
commit's file, and run it from there in an elevated Windows PowerShell (the
harness imports `..\runtime` and `..\installer`; it runs with the installed
release's own `node.exe`, so no developer tooling is needed). Delete the
folder after the run:

```powershell
.\acceptance\Acceptance.ps1 -Out <evidence folder>\checks-<n>.json -Commit <40 hex> `
    [-Bundle <bundle folder> -ManifestSha256 <recorded hash>]
```

It runs only read-only checks (platform facts, bundle verification,
services, listeners, Windows-trusted HTTPS, ACLs, tasks, shortcuts,
`diagnose.mjs check --json`, `backup.mjs status`, the upgrade journal) and
writes a new JSON (an existing file is refused). Connection strings,
`password=`/`secret=`/`token=` values, JWTs and long key-like strings are
redacted; SHA-256 digests are kept. Status per check: `pass`, `fail`,
`error` (the command could not run) or `manual` (needs the operator). It
lists every manual scenario. **A harness pass is not acceptance**: record
each scenario below. Exit 0 no failures, 1 something failed, 2 usage, 3
refused (not Windows, or the output exists). Run it again after each
lifecycle step (B2, B8, B11, B12) with a new `-Out`.

The harness has been tested on Linux with recorded Windows command output
only (`acceptance.test.mjs`); it has **not run on Windows**. A PowerShell
parse error or a command whose output differs from the recordings is itself
a finding: record it in C2 and fix the harness.

## R1. Release bundle verified before install

Steps (vendor build machine, then target):

1. Build: `node packaging/single-pc/installer/bundle.mjs --out <new folder>`;
   note the printed `bundle-manifest.json SHA-256` in the build log kept apart
   from the USB stick.
2. `node packaging/single-pc/acceptance/readiness.mjs --bundle <folder>
--manifest-sha256 <hash>` exits 0.
3. On the target: `(Get-FileHash .\bundle-manifest.json).Hash` equals the
   recorded hash.

Expected: readiness "Ready (bundle verified)"; the hashes match.

Evidence: build log `____`, readiness output `____`, `Get-FileHash` `____`.
Result (PASS/FAIL): `____`

## Part A: #357 platform proof

### A1. Target eligibility (CPU, OS, storage)

Steps:

1. `winver` and `Get-CimInstance Win32_OperatingSystem | Select Caption,Version,BuildNumber,OSArchitecture`.
2. `Get-CimInstance Win32_Processor | Select Name,Manufacturer,NumberOfCores,NumberOfLogicalProcessors,Architecture`.
3. `Get-PhysicalDisk | Select FriendlyName,MediaType,BusType,Size` and `Get-Volume`.
4. Check the CPU against Microsoft's Windows 11 supported processor lists and
   the build against Windows 11 release health (still serviced).

The harness `platform` check records steps 1–3 and refuses non-client, non-x64
or non-Intel/AMD; step 4 stays manual.

Expected: Windows 11 client edition (not Server, not Windows 10), x64,
Intel/AMD (not ARM); CPU on the supported list; serviced build.

Evidence: command output `____`, CPU list entry/link `____`, servicing status
`____`. Result (PASS/FAIL): `____`

### A2. Component qualification

Steps:

1. Confirm the archives match [../components.json](../components.json)
   (version, URL, SHA-256); `run.mjs` and `bundle.mjs` refuse a mismatch; also
   record `Get-FileHash -Algorithm SHA256` per archive.
2. Preserve upstream signature/provenance and license files for Node and
   MongoDB (`release\notices\`).
3. Confirm MongoDB 7.0 lists Windows 11 x86_64 as supported for this build.

Expected: hashes match; licenses retained; upstream support covers the target.

Evidence: pinned SHA-256 `____`, observed SHA-256 `____`, license files
`____`, upstream support link and date `____`. Result (PASS/FAIL): `____`

### A3. Compiled-runtime proof

Steps: follow [../proof/README.md](../proof/README.md) ("Prepare on the
Windows build machine", then "Run on the actual target"); run `run.mjs` with
`--api`, `--node-archive`, `--mongo-archive`, `--output` (new file) and
`--commit`.

Expected: exit 0 and a new evidence JSON covering native argon2 (A4),
authenticated transactions (A5), anonymous refusal and HTTP login/profile
through the compiled API.

Evidence: exit code `____`, console output `____`; on success the evidence
JSON path and SHA-256 `____`; on failure the fixed failure message `____`
(use a new output path for any retry). Result (PASS/FAIL): `____`

### A4. Native password verification

Steps: in the A3 evidence read `assertions.defaultArgon2CorrectAndWrongPassword`
and `observations.passwordProofMs`.

Expected: `true`; timing recorded.

Evidence: value `____`, `passwordProofMs` `____`. Result (PASS/FAIL): `____`

### A5. Authenticated MongoDB transactions

Steps: in the A3 evidence read `assertions.authenticatedPrimary`,
`unauthorizedReadRefused`, `transactionCommit`, `transactionRollback`.

Expected: all four `true`.

Evidence: values `____`. Result (PASS/FAIL): `____`

### A6. Hardware measurements (4 GB RAM target)

The 4 GB figure is a target to qualify, not a proven minimum.

Steps:

1. Record PC/VM identity (section 0; a VM needs 4 GB and 2+ vCPUs, and the
   expected low-end PC must also be covered).
2. Before A3: `Get-Counter '\Memory\Available MBytes','\Processor(_Total)\% Processor Time'`.
3. During A3: `Get-Counter ... -SampleInterval 2 -Continuous > a6-samples.txt`
   (stop after A3); record the peak and the A3 `observations`
   (`hostRamBytes`, `freeRamBytesAtEnd`, `cpuCount`).
4. Record MongoDB's WiredTiger cache (unset in `mongod.cfg`, so MongoDB's
   default of 50% of RAM − 1 GB applies) and decide an explicit cap with B14
   (#360/#357 qualification item).

Expected: A3 completes without paging stalls; these figures alone do not
qualify 4 GB.

Evidence: idle MB `____`, lowest MB `____`, CPU peak `____`, samples
`____`, observations `____`, cache decision `____`, limitations `____`.
Result (PASS/FAIL): `____`

## Part B: #366 package scenarios

Each needs the installed package version `____` and Chrome version `____`.
Use test records only.

### B1. Clean install

Steps: on a fresh Windows 11 x64 without developer tools, follow
[../operations/INSTALL.md](../operations/INSTALL.md) exactly with the
network unplugged: `Install.ps1 -ManifestSha256 <hash> -Mode install
-AdminUsername <name>`. Open the "Grocery POS" shortcut, log in with the
handover password, change it when asked. Run the harness.

Expected: exit 0; three services running; the shortcut opens Chrome at the
app; login forces the password change; harness `services`, `shortcuts`,
`tasks` pass.

Evidence: installer console `____`, screenshots `____`, harness file
`____`, install duration (min) `____`. Result (PASS/FAIL): `____`

### B2. Reboot

Steps: restart Windows; do not log in for 3 minutes; from the lock screen
check nothing (or from another admin session: `Get-Service GroceryPOS-*`);
then log in, open the shortcut, log in to the app; harness again.

Expected: services Running before Windows logon; data intact.

Evidence: service start times (`Get-WinEvent -LogName System
-FilterXPath "*[System[EventID=7036]]"`) `____`, harness `____`.
Result (PASS/FAIL): `____`

### B3. Internet off, local API reachable

Steps: unplug the network / disable Wi-Fi; confirm `Test-NetConnection
8.8.8.8` fails; in Chrome open/close a shift, product lookup and search,
checkout of an expiry-tracked item, a discount with ADMIN PIN approval, a
void with manager approval, inventory and stock history, a sales report and
store settings, each under the role that is allowed.

Expected: everything works under existing role rules; no "offline" banner
while the local API answers (#359).

Evidence: screenshots per step `____`, role used per step `____`.
Result (PASS/FAIL): `____`

### B4. Real API outage and recovery

Steps: with a shift open and "Offline cash ready" shown, `Stop-Service
GroceryPOS-API` (elevated); record a cash sale offline (permitted path
only); try a discount and GCash (expect refusal); `Start-Service
GroceryPOS-API`; watch the queue upload. Then a lost response: start a
checkout and stop the API right after pressing Charge (or block the
response), restart, let the register retry.

Expected: refusals as designed; queued receipt syncs exactly once; the
retried checkout yields one sale (same idempotency key), no duplicate.

Evidence: screenshots `____`, Sales list before/after `____`.
Result (PASS/FAIL): `____`

### B5. Authenticated transactions on the installed DB

Steps: `mongodb\bin\mongod.exe` has no shell in the bundle; use the A3 proof
or, with `node.exe`, connect anonymously to `127.0.0.1:27018` and attempt a
read (expect refusal); make a sale that fails mid-way (e.g. stock conflict
from a second tab) and check no partial stock/sale.

Expected: anonymous access refused; no partial writes.

Evidence: output `____`. Result (PASS/FAIL): `____`

### B6. LAN refusal

Only Caddy's HTTPS on the configured LAN IP is reachable from the LAN, and
only from a joined terminal on the same subnet over a Private network
(#393–#396). Install or repair with `-LanIp <IP>` and join a terminal (D2)
first.

Steps: harness `listeners` (local). From the joined terminal:
`Test-NetConnection <IP> -Port 1443`, `13000`, `27018`; Chrome at
`https://<IP>:1443/`; `https://<IP>:1443/v1/health`, `/v1/health/live` and
`/v1/health/ready` (Chrome and `Invoke-WebRequest`). From a device on another
subnet (a second router or VLAN): `Test-NetConnection <IP> -Port 1443`. Then
switch the main PC's network profile to Public and repeat 1443 from the
terminal; switch it back to Private.

Expected: harness pass (loopback listeners plus `<IP>:1443`, only while
`GroceryPOS-ProxyLan` runs). From the terminal, 1443 connects and Chrome
shows the app with no certificate warning; 13000 and 27018 are refused or
time out; every `/v1/health*` URL on `https://<IP>:1443` is refused (404),
never a health answer. 1443 is refused or times out from the other subnet,
and from the terminal while the profile is Public.

Evidence: harness `____`, terminal output `____`, other-subnet output
`____`, Public-profile output `____`. Result (PASS/FAIL): `____`

### B7. Replacement-PC restore

Steps: on PC 1 make test sales, a backup and a USB export ("Back up to USB
drive"); on a second clean PC follow
[../operations/REPLACEMENT-PC.md](../operations/REPLACEMENT-PC.md) exactly
(`Install.ps1 -Mode restore-verify`, then `-Mode restore -From <full path>
-Confirm <id>`); record the restore duration. Before the real restore, on a
**copy** of the bundle, change one byte of
`release\mongodb\bin\mongorestore.exe`, and separately add an extra file
under `release\api\`; run `-Mode restore` from each copy. Also try
`-Mode restore` without `-Confirm` and with a relative `-From`. Hostile
folders, one at a time, each removed by an administrator afterwards:
(a) as a **standard user**, create an empty
`C:\ProgramData\Valorthon\GroceryPOS`; (b) as an administrator, create it
and grant `Everyone` full control (`icacls <path> /grant *S-1-1-0:(OI)(CI)F`);
(c) as a standard user, create `C:\ProgramData\Valorthon` itself (on a PC
where it does not exist yet); (d) as an administrator, make
`C:\ProgramData\Valorthon\GroceryPOS` a junction to another folder
(`mklink /J`). After the real restore, `icacls` on the data root and
`secrets\` shows owner Administrators, no inherited entries, SYSTEM and
Administrators only (plus the service grants after install).
`-Mode restore-verify` on the fresh PC must leave no
`C:\ProgramData\Valorthon\GroceryPOS` and no `…-Verify` folder behind;
kill one `-Mode restore-verify` during its test restore (Task Manager, end
`node.exe`) and run it again: it refuses and keeps the folder untouched.
Restart the PC, then as an administrator delete only
`C:\ProgramData\Valorthon\GroceryPOS-Verify` and retry: verification
succeeds. Also launch a second check while the first is still running: it
refuses, never stops the first check's database or removes its files.

Expected: the tampered and extra-file copies are refused (exit 3, "does not
match the bundle manifest" / "unlisted file") with nothing changed; missing
`-Confirm` and a relative `-From` are refused; hostile folders are refused
before any secret is copied: (a) "already exists and is owned by S-1-5-21-…",
(b) "is not admin-only (grants S-1-1-0)", (c) "C:\ProgramData\Valorthon is
owned by …", (d) "is a link or junction"; the real restore needs
`-Confirm`; data and logins restored; everyone must log in again; harness
`backup-status` passes after the first new backup.

Evidence: refusal outputs `____`, restore output `____`, duration (min)
`____`, screenshots `____`. Result (PASS/FAIL): `____`

### B8. Populated and interrupted upgrade

Steps: install release N, populate (products, sales, shifts closed, backup
verified); build N+1; follow [../operations/MAINTENANCE.md](../operations/MAINTENANCE.md)
"Upgrade" and time it. Repeat on a second populated copy, cutting power
during `migrate` (or `Stop-Process` the node upgrade process), then follow
RECOVERY.md "After an interrupted or failed upgrade". Harness after each.

Expected: data kept; journal `complete`; harness `upgrade-window` pass (≤ 30
min); the interrupted run resumes or rolls back as documented.

Evidence: `-Mode upgrade-status` output `____`, harness `____`, total
minutes `____`. Result (PASS/FAIL): `____`

### B9. Stale browser assets

Steps: leave a Grocery POS tab open across an upgrade (contrary to the
procedure, on purpose); after the upgrade act in that tab.

Expected: "Grocery POS was updated" dialog; Reload loads the new version;
the old service worker is replaced (`chrome://serviceworker-internals`).

Evidence: screenshots `____`. Result (PASS/FAIL): `____`

### B10. Pending receipt preservation

Steps, part 1 (lifecycle):

1. Queue offline cash receipts (B4 method) and keep them pending. Attempt
   an upgrade: it must refuse the open shift/active offline lease before
   changing the release, and the pending count and receipt numbers stay.
2. Restore the API, upload the receipts, release offline mode and close all
   shifts. Upgrade normally; verify each original receipt exists exactly
   once, with no receipt left pending.
3. Separately queue new offline receipts. In Chrome DevTools enable
   request blocking for `*/v1/*`, then repair and uninstall/reinstall the
   same release (B12), retaining Chrome's profile and site data. Keep the
   blocking rule enabled while services restart, so a successful upload
   cannot clear the queue before inspection. After each operation, inspect
   the pending receipt numbers in IndexedDB/outbox. Remove the blocking rule
   and verify each receipt uploads exactly once.

Steps, part 2 (restore with queued receipts, #363/#37): on a test register
with an open shift and "Offline cash ready":

1. Make a backup (`backup.mjs create --kind manual`, or "Back up to USB
   drive"), note its id.
2. Stop the API (`Stop-Service GroceryPOS-ProxyLan -ErrorAction
SilentlyContinue; Stop-Service GroceryPOS-Proxy, GroceryPOS-API`) and record
   two offline cash sales: R1 and R2. Note their receipt numbers and the
   register's pending count (2).
3. Start the API and let only R1 upload (stop it again right after R1
   shows as synced; pending count 1). R1 is now a server sale made after
   the backup.
4. With the services stopped, restore the backup with
   `Install.ps1 -Mode restore -From <full path> -Confirm <id>`: it must
   refuse open shifts, active offline leases and newer sales; re-run with
   `-AcceptOpenShifts -AcceptPendingOffline -AcceptNewerSales`.
5. Start the services; in Chrome on the same register log in again (all
   sessions ended): R2 stays queued and is refused with "needs admin
   reconciliation", never uploaded automatically and never deleted.
6. As an ADMIN on that register, reconcile R2 with a reason. Then reload
   and check the queue is empty.
7. Sales list: R2 appears exactly once; R1 is gone with the restore (it was
   recorded after the backup) unless its receipt was still queued, in which
   case it is reconciled like R2, also exactly once. Count the drawer and
   record any cash sale that no longer exists anywhere by hand
   (backup README "Browser data").

Expected: part 1: upgrade refusal preserves the queue; after synchronization
and shift close the upgrade succeeds. Repair/reinstall keep Chrome receipts,
which upload exactly once. Part 2:
each `-Accept…` refusal shown; R2 survives the restore in Chrome, needs
ADMIN reconciliation with a reason, appears once; no duplicate receipt; the
restore audit entry `SYSTEM.DATABASE_RESTORED` lists the accepted overrides
(Audit Log).

Evidence: queue counts per step `____`, refusal outputs `____`, Sales list
before/after `____`, Audit Log screenshot `____`.
Result (PASS/FAIL): `____`

### B11. Crash recovery

Steps: End task on `mongod.exe`, then on the API's `node.exe`, then on
`caddy.exe` (Task Manager), watching each recover; then cut power once
mid-session.

Expected: SCM recovery restarts each (10 s / 30 s / 60 s); committed data
intact; no partial sale; RECOVERY.md "Interrupted shutdown" holds.

Evidence: restart times `____`, harness `____`. Result (PASS/FAIL): `____`

### B12. Repair, uninstall, reinstall

Steps: `-Mode repair`; log in. `-Mode uninstall`; check the data root is
kept. `-Mode install` again (reinstall); log in with the owner's changed
password. Harness after each.

Expected: database, backups, secrets and settings retained; no second admin;
login works after each.

Evidence: outputs `____`, harness files `____`. Result (PASS/FAIL): `____`

### B13. Local HTTPS origin

Steps: Chrome at `https://localhost:1443`; harness `trusted-origin`.

Expected: no certificate warning; harness pass (Windows trust store).

Evidence: screenshot of the padlock/certificate viewer `____`, harness
`____`. Result (PASS/FAIL): `____`

### B14. Workload on target hardware

Steps: on the 4 GB PC with Chrome open: cold start to login (s), a
200-line checkout (s), a 30-day sales report (s), a stock count approval
(s); sample counters as in A6.

Expected: acceptable timings, no paging stalls; record peak memory.

Evidence: timings `____`, samples `____`. Result (PASS/FAIL): `____`

### B15. Documentation deliverable

Steps: perform INSTALL, MAINTENANCE (daily startup/shutdown, upgrade),
REPLACEMENT-PC, HANDOVER and RECOVERY as written, noting every deviation.

Expected: each procedure works as written; deviations fixed in the docs
before release.

Evidence: deviations list `____`. Result (PASS/FAIL): `____`

### B16. Installer ACLs

Steps: harness `acl-handover` and `acl-data` (it saves `icacls` for the data
root, `secrets\` and each secret file, `database\`, `tls\`, `logs\`,
`backups\` and the handover folder); as a standard user try `type
%ProgramData%\Valorthon\GroceryPOS\secrets\api.env` and the handover file.

Expected: the runtime README "Permissions" table only; handover: no
inherited entries, only SYSTEM and Administrators; the standard user is
denied.

Evidence: harness `____`, denial output `____`. Result (PASS/FAIL): `____`

### B17. Back up to USB drive

Steps: as the owner, "Back up to USB drive": with one USB stick, with two
(the list must show two entries: PowerShell 5.1 array nit, #362), with none,
with a full stick; accept and decline the UAC prompt; with a standard daily
account note that an administrator password is needed.

Expected: elevation asked; a fresh verified backup exported; plain
success/failure messages.

Evidence: screenshots `____`, export folder listing `____`.
Result (PASS/FAIL): `____`

## Part C: Windows-only items left by #358–#365

### C1. Browser auth flows at the installed origin (#358)

Steps: in Chrome at `https://localhost:1443`: login, wait for an access
token refresh (or force one), logout, own password change, a step-up
(create a user), a manager PIN approval (discount).

Expected: each works; cookies are host-only, Secure, `SameSite=Lax`
(DevTools > Application > Cookies).

Evidence: screenshots `____`. Result (PASS/FAIL): `____`

### C2. Service registration, accounts, env and TLS state (#360, #362)

Steps: harness `services` and `acl-data`; `sc qc GroceryPOS-API` (and the
others); check `node --env-file` started the API with Windows paths
(`logs\api\`), Caddy's state under `tls\` (including `autosave.json`);
`Stop-Service GroceryPOS-MongoDB` and confirm a clean shutdown line in
`logs\mongod.log`; power off once during provisioning of a fresh install
and re-run `-Mode install`. Any harness parse or output mismatch is recorded
here.

Expected: `NT SERVICE\GroceryPOS-*` accounts, automatic start, dependency
order MongoDB → API → Proxy, recovery actions set; interrupted provisioning
resumes without regenerating secrets.

Evidence: outputs `____`. Result (PASS/FAIL): `____`

### C3. Listener binds (#358, #360, #396)

Steps: harness `listeners`; `Get-NetTCPConnection -State Listen -LocalPort
1443,13000,27018`; with a LAN IP set, `Get-Service GroceryPOS-ProxyLan`,
then stop that service and run the harness again, then start it.

Expected: 127.0.0.1:27018, 127.0.0.1:13000, 127.0.0.1:1443 and [::1]:1443,
plus `<LAN IP>:1443` only when a LAN IP is configured and only while
`GroceryPOS-ProxyLan` is not stopped (as diagnostics' `ports` check). Any
other address, a LAN listener on 13000/27018, or one on the LAN IP while the
service is stopped fails.

Evidence: harness (running, stopped) `____`. Result (PASS/FAIL): `____`

### C4. Tasks, Windows backup tools and media checks (#362, #363)

Steps: harness `tasks` and `backup-status`; run `\GroceryPOS\Daily backup`
now (`schtasks /Run`) and check it writes a verified backup as SYSTEM; time
backup and restore on the 4 GB PC; the Monday export reminder appears;
`backup.mjs export` to a USB stick, a USB hard disk, an SD card (accepted)
and a second internal disk, a folder mount and a `subst` drive onto C:
(refused); rename/lock behaviour on NTFS during a backup.

Expected: as backup README; refusals name the reason.

Evidence: outputs `____`, durations `____`. Result (PASS/FAIL): `____`

### C5. Failure exercises (#365)

Steps: one at a time, then run "Check Grocery POS" and follow its section of
RECOVERY.md: stop the API; stop MongoDB; fill the disk below the warning
level (a large dummy file on a test PC); make a backup fail (stop MongoDB
during it); let log rotation run (`schtasks /Run /TN "\GroceryPOS\Nightly
log rotation"`).

Expected: each named correctly by the check; the recovery steps work; logs
bounded.

Evidence: check outputs `____`. Result (PASS/FAIL): `____`

### C6. Owner tools: Check, help, standard user (#365)

Steps: "Check Grocery POS": accept elevation (full check), decline it
(partial check that says what it could not see); "Save support file…" to a
USB stick; "Grocery POS help" opens the guide; repeat as a standard user.

Also open **Grocery POS owner guide** (Start menu, next to the help
entry): Notepad shows `help\HANDOVER.md`; uninstall removes the entry.

Expected: as diagnostics README; the support file holds no sales data,
passwords or names; a brief console flash is a known gap.

Evidence: screenshots, support file `____`. Result (PASS/FAIL): `____`

### C7. Upgrade modes and the 30-minute window (#364)

Steps: during B8 also run `-Mode upgrade-status` and, on a copy that needs
recovery, `-Mode upgrade-rollback -RestoreBackup <id>`; check `sc qc` shows
API/Proxy `DEMAND_START` while stopped and `AUTO_START` after; time from
"all shifts closed" to "app usable" against 30 min on a realistic
(populated) database.

Expected: modes parse and run; harness `upgrade-window` pass.

Evidence: outputs, minutes `____`. Result (PASS/FAIL): `____`

### C8. Preflight refusals and stop timing (#362)

Steps: run `-Mode install` on (or simulate on test PCs) Windows 10, an ARM
PC, a PC with port 1443 taken, and a nearly full disk: each refused with
nothing changed. Measure how long `Stop-Service GroceryPOS-MongoDB` takes
with an active database (mongod's 60 s stop wait cannot be set through `sc`).

Expected: exit 3 and fixed messages; stop time recorded.

Evidence: outputs `____`, stop seconds `____`. Result (PASS/FAIL): `____`

## Part D: LAN terminals on two-PC hardware (#401)

A vendor-owned main PC installed with `-LanIp <IP>` and at least one Windows
11 terminal on the same isolated shop LAN, both with test data only. The
Android Chrome rows come with #400 and are added here when it lands.

### D1. LAN site service, firewall and shared root

Steps: `Get-Service GroceryPOS-Proxy, GroceryPOS-ProxyLan`; `sc qc
GroceryPOS-ProxyLan` (dependency on `GroceryPOS-Proxy`); stop
`GroceryPOS-Proxy` and check both stop in order, then start them. Pull the
main PC's cable (the LAN address goes away): only `GroceryPOS-ProxyLan`
fails and SCM keeps retrying it, `https://localhost:1443` keeps working;
plug it back in and the service recovers by itself. `netsh advfirewall
firewall show rule name=GroceryPOS-LAN-HTTPS verbose`. Compare the issuer of
the leaf served on `https://localhost:1443` and on `https://<IP>:1443`.

Expected: the rule is TCP 1443, `program=<release>\caddy\caddy.exe`,
`localip=<IP>`, `remoteip=localsubnet`, `profile=private`, no service filter,
and a terminal on the subnet reaches `https://<IP>:1443` with only that rule;
nothing reaches loopback-bound ports from the LAN. `import app.caddy`
resolves in the release's `caddy\` folder and the client is served from
`{$GPOS_CLIENT_ROOT}` (a backslash path). Both Caddy processes share
`tls\data`: one root issues both leaves. "Check Grocery POS" shows **LAN
terminals** OK while `GroceryPOS-ProxyLan` runs and WARN while it is
stopped.

Evidence: outputs `____`, screenshots `____`. Result (PASS/FAIL): `____`

### D2. Join, rejoin and leave a Windows terminal

Steps: on the main PC, "Make terminal package" (Start menu): elevation
prompt, folder picker on a USB drive; also once with no LAN IP set. On the
terminal, from an elevated PowerShell 5.1, `JoinTerminal.ps1 -Mode join`;
check certlm.msc, `%ProgramData%\Valorthon\GroceryPOS-Terminal\terminal.json`,
`w32tm /query /configuration`, the Chrome shortcuts (Public Desktop, common
Start menu). Edit `root.crt` in a copy and join with it; join with another
main PC's package; `-Mode rejoin` with a new package; `-Mode leave`; run the
script as a non-admin user.

Expected: the package is `GroceryPOS-terminal-<IP>\` (root.crt with no key,
terminal.json, JoinTerminal.ps1, README.txt); without a LAN IP it is
refused with a plain message. Join puts the root in the machine Root store
under the recorded thumbprint (shown on both PCs), sets w32time Automatic
with NtpServer `<IP>,0x8` and resyncs once the main PC serves time (D10);
the shortcut opens `https://<IP>:1443/` with no warning and the service
worker registers ("Offline cash ready" can show); the TLS check reports
Done, and with the main PC off fails with the plain message. An edited
root is refused with "SHA-256 differs" and nothing changes; another main
PC's package is refused for `join`. Rejoin removes only the old root (by
thumbprint), other Caddy roots stay. Leave removes only our root and both
shortcuts, keeps the time setting, and Chrome then refuses the site. A
non-admin run is refused with "Run this from an administrator PowerShell
window".

Evidence: outputs `____`, screenshots `____`. Result (PASS/FAIL): `____`

### D3. Concurrent sales on two terminals

Steps: two cashiers, each with an open shift, one on the main PC
(`https://localhost:1443`) and one on the terminal (`https://<IP>:1443`).
Sell the same product on both at the same moment, including its last units;
repeat a few times; then close both shifts. Check the Audit Log's client IP
for each terminal and a wrong-password lockout on one terminal.

Expected: both sales complete or one is refused for stock, never
oversold; each shift's Z-read has only its own sales; the audit shows the
terminal's own LAN address (main PC as 127.0.0.1); a lockout on one
terminal does not lock the other (#395).

Evidence: screenshots, audit rows `____`. Result (PASS/FAIL): `____`

### D4. Cable pull mid-shift, offline cash and sync

Steps: on the terminal, wait for "Offline cash ready", then pull its cable
during an open shift. Take cash sales (and try GCash, a discount, a void:
refused offline). Plug it back in and let the outbox sync; close the shift.

Expected: #359/#37 semantics: offline cash only, receipts durable before the
basket clears, synced once with no duplicates, occurrence time kept; the
shift closes only after the queue drains.

Evidence: screenshots, sale ids `____`. Result (PASS/FAIL): `____`

### D5. Upgrade with a stale terminal tab

Steps: leave a terminal tab open (with a basket and, if possible, a queued
offline receipt) while the main PC is upgraded (B8). Use the stale tab.

Expected: the "Grocery POS was updated" / "Reload to continue." dialog
(`CLIENT_OUTDATED`) with only Reload; the basket and outbox survive the
reload and the queued receipt syncs. The docs' upgrade steps (close tabs,
sync offline cash on every terminal) match what happens.

Evidence: screenshots `____`. Result (PASS/FAIL): `____`

### D6. Restore logs every terminal out

Steps: with both PCs logged in (no open shifts or leases), restore a
verified backup on the main PC (`restore.mjs --confirm <id>`); use each tab.

Expected: every terminal and the main PC are sent to Log in; logging in
again works; the docs' restore step (log out every terminal) matches.

Evidence: screenshots `____`. Result (PASS/FAIL): `____`

### D7. Replacement PC, then rejoin

Steps: B7 onto a second PC with the same LAN IP (the backup carries the
Caddy root pair); open the terminal's shortcut; then repeat on a PC whose
restore did not seed the root and run `JoinTerminal.ps1 -Mode rejoin` with
a new package.

Expected: with the seeded root the terminal connects with no warning and no
rejoin, and the LAN IP is kept and reported; with a new root, rejoin is
needed and works. The docs' replacement-PC steps match.

Evidence: outputs `____`. Result (PASS/FAIL): `____`

### D8. LAN IP change

Steps: try `-Mode repair -LanIp <new IP>` with a shift open (refused), then
with none; also try `-LanIp` on `install` over an existing root (refused).
Make a new terminal package and `-Mode rejoin` on the terminal.

Expected: refusals change nothing; repair moves `LAN_ORIGIN`, the LAN
service and both firewall rules to the new IP; the terminal works at the
new origin after rejoin (its browser storage there starts empty). The docs'
LAN address change steps match.

Evidence: outputs `____`. Result (PASS/FAIL): `____`

### D9. Terminal clock ±5 min and ±3 h

Steps: on the terminal, stop w32time and set the clock 5 min fast, then
5 min slow; take offline cash (D4 flow) at each and sync. Repeat at ±3 h.
Restore the clock and w32time afterwards.

Expected: at ±5 min the register warns about the clock (above 30 s) and the
offline cash syncs with corrected `soldAt`. At ±3 h record what happens:
Chrome's certificate check against the 12 h leaf, the warning and whether
offline cash is accepted; any refusal names the clock, never silent loss.

Evidence: screenshots, sale ids `____`, ±3 h behaviour `____`. Result
(PASS/FAIL): `____`

### D10. Time server (NTP) rule and `timeServer` check

Steps: on the main PC `netsh advfirewall firewall show rule
name=GroceryPOS-LAN-NTP verbose`, `w32tm /query /configuration`; on the
terminal `w32tm /resync` and `w32tm /stripchart /computer:<IP>
/samples:3`. Stop w32time on the main PC and run "Check Grocery POS"; start
it again.

Expected: the rule is UDP 123, `localip=<IP>`, `remoteip=localsubnet`,
Private; NtpServer enabled with `/reliable:yes`; the terminal resyncs from
the main PC with no internet. `timeServer` is OK while w32time runs, WARN
while it is stopped, info without a LAN IP. After an upgrade from a release
before #398, repair applies the time server.

Evidence: outputs `____`. Result (PASS/FAIL): `____`

### D11. Caddy leaf renewal: "not yet valid" watch

Steps: throughout D3–D10 (at least a full day), keep a terminal open across
Caddy's `tls internal` leaf renewals (12 h lifetime, renewed several times a
day); note each renewal time from the Caddy log.

Expected: no Chrome "certificate not yet valid" error right after a
renewal. If one occurs, record it here and on #401 (the fix is setting the
leaf lifetime/renewal in the Caddyfile, as #398 allowed).

Evidence: renewal times `____`, errors seen `____`. Result (PASS/FAIL):
`____`

### D12. `lanNetwork` and `lanProxy` diagnostics

Steps: `diagnose.mjs check` (and "Check Grocery POS") with a LAN IP set, on
a Private network, rule enabled, valid certificate; then each in turn:
remove or change the adapter's IP (DHCP drift); switch the profile to
Public; disable, then delete, `GroceryPOS-LAN-HTTPS`; run not elevated (the
local root unreadable); remove the LAN IP (`repair -LanIp none`). Save a
support file.

Expected: `lanNetwork` ok in the first state; warns that this PC no longer
has the IP (with the re-join steps), that the network is Public, and for
the disabled and the deleted rule; not elevated, the certificate is
`unverified` and the check `unknown`, never ok; without a LAN IP it is info.
`lanProxy` as D1. The support file has the LAN IP redacted from
`lanNetwork` details.

Evidence: outputs `____`, support file `____`. Result (PASS/FAIL): `____`

### D13. Terminal label before a shift

Steps: on a terminal with no saved label, open Shift In; as ADMIN save the
label in Store settings on that terminal, also from another tab while Shift
In is open; open and close a shift. On the main PC open a shift without a
label.

Expected: without a label Shift In shows "Ask an admin to set this
terminal's label in Store settings." and Open Register is disabled; after
saving (either tab) it is enabled and the Z-read shows the label. The main
PC opens a shift without one.

Evidence: screenshots `____`. Result (PASS/FAIL): `____`

## Known limitations to record, not to fix here

- MongoDB SSPL source-offer wording needs legal clearance before customer
  distribution (#362).
- MongoDB series moves (7.0 → 8.0) are refused, not supported (#364).
- Concurrent provisioning runs: with three runs and a stale lock, a live
  run's lock can be lost (#360 nit). The installer is run by one vendor at a
  time; record any observed lock refusal in C2.
- Code signing is deferred; the out-of-band manifest hash is the trust
  anchor (R1).

## Sign-off

Operator `____`, reviewer `____`, date `____`. Part A with all PASS and
independent review may close #357; Parts B and C with all PASS, plus the
evidence files, may close #366 and the Windows-only remainders of #358–#365.
B6 and Part D with all PASS on the two-PC hardware may close #401's Windows
rows; its Android rows wait for #400.
