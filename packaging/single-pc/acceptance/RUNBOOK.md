# Windows 11 x64 acceptance runbook (#357, #366)

The one executable runbook for accepting a single-PC release on the target.
It replaces [../proof/ACCEPTANCE-CHECKLIST.md](../proof/ACCEPTANCE-CHECKLIST.md)
and keeps that file's numbering: **A1–A6 and B1–B17 are unchanged**. The new
**C1–C8** collect the Windows-only items that #358–#365 left open, and **R1**
is the release check done before anything is installed.

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

| Id  | Scenario                                            | Closes           | Harness |
| --- | --------------------------------------------------- | ---------------- | ------- |
| R1  | Release bundle verified before install              | #366             | yes     |
| A1  | Target eligibility (CPU, OS, storage)               | #357             | yes     |
| A2  | Component qualification                             | #357             | partly  |
| A3  | Compiled-runtime proof (`proof/run.mjs`)            | #357             | no      |
| A4  | Native password verification                        | #357             | no      |
| A5  | Authenticated MongoDB transactions                  | #357             | no      |
| A6  | Hardware measurements (4 GB target)                 | #357             | no      |
| B1  | Clean install, first ADMIN, forced change           | #366, #361, #362 | partly  |
| B2  | Reboot before Windows logon                         | #366, #360, #362 | partly  |
| B3  | Internet off, local API reachable                   | #366, #359       | no      |
| B4  | Real API outage and recovery                        | #366, #359       | no      |
| B5  | Authenticated transactions on the installed DB      | #366             | no      |
| B6  | LAN refusal                                         | #366, #358       | partly  |
| B7  | Replacement-PC restore                              | #366, #363       | partly  |
| B8  | Populated and interrupted upgrade                   | #366, #364       | partly  |
| B9  | Stale browser assets                                | #366, #364       | no      |
| B10 | Pending receipt preservation                        | #366, #364, #363 | no      |
| B11 | Crash and power-cut recovery                        | #366, #360, #362 | no      |
| B12 | Repair, uninstall, reinstall                        | #366, #362       | no      |
| B13 | Local HTTPS origin without warning                  | #366, #358, #362 | partly  |
| B14 | Workload on the 4 GB PC                             | #366, #357       | no      |
| B15 | Documentation followed as written                   | #366             | no      |
| B16 | Installer ACLs                                      | #362, #360, #361 | yes     |
| B17 | Back up to USB drive                                | #362, #363       | no      |
| C1  | Browser auth flows at the installed origin          | #358             | no      |
| C2  | Service registration, accounts, env and TLS state   | #360, #362       | yes     |
| C3  | Listener binds                                      | #358, #360       | yes     |
| C4  | Scheduled tasks, Windows backup tools, media checks | #362, #363       | partly  |
| C5  | Failure exercises                                   | #365             | partly  |
| C6  | Owner tools: Check, help, standard user             | #365             | partly  |
| C7  | Upgrade modes and the 30-minute window              | #364             | partly  |
| C8  | Preflight refusals and stop timing                  | #362             | no      |

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
| Second LAN device (for B6)                    | `____` |
| Two USB drives, one SD card (for B17/C4)      | `____` |
| Evidence folder path                          | `____` |

## Harness

On the target, after B1, from an elevated Windows PowerShell in a copy of the
source's `packaging\single-pc\` folder (the harness imports `..\runtime` and
`..\installer`; it runs with the installed release's own `node.exe`, so no
developer tooling is needed):

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

Steps: harness `listeners` (local); from a second LAN device:
`Test-NetConnection <PC IP> -Port 1443`, `13000`, `27018` (or `nc -vz`), and
a browser at `https://<PC IP>:1443`.

Expected: harness only loopback listeners; every remote attempt refused or
timed out.

Evidence: harness `____`, remote output `____`. Result (PASS/FAIL): `____`

### B7. Replacement-PC restore

Steps: on PC 1 make test sales, a backup and a USB export ("Back up to USB
drive"); on a second clean PC follow
[../operations/REPLACEMENT-PC.md](../operations/REPLACEMENT-PC.md) exactly;
record the restore duration.

Expected: `--confirm` required; data and logins restored; everyone must log
in again; harness `backup-status` passes after the first new backup.

Evidence: restore output `____`, duration (min) `____`, screenshots `____`.
Result (PASS/FAIL): `____`

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

Steps: queue offline cash receipts (B4 method) and do not let them upload;
then perform an upgrade, a repair and a reinstall in turn (stop the API
again before each so the queue stays); bring the API back.

Expected: receipts stay in Chrome and upload exactly once afterwards (after
a restore they need ADMIN reconciliation, #363).

Evidence: queue counts before/after `____`, Sales list `____`.
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

### C3. Listener binds (#358, #360)

Steps: harness `listeners`; `Get-NetTCPConnection -State Listen -LocalPort
1443,13000,27018`.

Expected: 127.0.0.1:27018, 127.0.0.1:13000, 127.0.0.1:1443 and [::1]:1443
only.

Evidence: harness `____`. Result (PASS/FAIL): `____`

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
