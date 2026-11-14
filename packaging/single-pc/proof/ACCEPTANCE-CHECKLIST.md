# Windows 11 x64 acceptance checklist (#357, later #366)

Operator runbook and evidence template. **Every field below is blank on
purpose.** Nothing here has been executed; no Windows 11 machine has been
available. Fill a copy per run, attach the captured files, and never record a
result that was not observed on the target. A blank or failed item keeps #357
(and its epic checkbox in #356) open.

Fields marked `____` are filled by the operator. Keep the filled copy with the
evidence files, not in this repository.

## 0. Run record

| Field                                      | Value  |
| ------------------------------------------ | ------ |
| Operator / date (store timezone)           | `____` |
| Source commit (full 40 characters)         | `____` |
| Windows edition, version, build (`winver`) | `____` |
| CPU model, vendor (Intel/AMD), cores       | `____` |
| Installed RAM (GB), type                   | `____` |
| Storage type (HDD/SATA SSD/NVMe), free GB  | `____` |
| Physical PC or VM (vCPUs, RAM, security)   | `____` |
| Chrome version (`chrome://version`)        | `____` |
| Node / MongoDB archive names and SHA-256   | `____` |
| Evidence folder path                       | `____` |

## Part A: #357 outstanding criteria

### A1. Target eligibility (CPU, OS, storage)

Steps:

1. Run `winver` and `Get-CimInstance Win32_OperatingSystem | Select Caption,Version,BuildNumber,OSArchitecture`.
2. Run `Get-CimInstance Win32_Processor | Select Name,Manufacturer,NumberOfCores,NumberOfLogicalProcessors,Architecture`.
3. Run `Get-PhysicalDisk | Select FriendlyName,MediaType,BusType,Size` and `Get-Volume`.
4. Check the CPU against Microsoft's Windows 11 supported processor lists and
   the build against Windows 11 release health (still serviced).

Expected: Windows 11 client edition (not Server, not Windows 10), x64,
Intel/AMD (not ARM); CPU on the supported list; serviced build.

Evidence: `____` (command output files), CPU list entry/link `____`,
servicing status `____`, result PASS/FAIL `____`.

### A2. Component qualification

Steps:

1. Confirm the archives match `../components.json` (version, URL, SHA-256).
   `run.mjs` refuses a mismatch; also record `Get-FileHash -Algorithm SHA256`.
2. Preserve upstream signature/provenance and license files for Node and MongoDB.
3. Confirm MongoDB 7.0 lists Windows 11 x86_64 as supported for this build.

Expected: hashes match; licenses retained; upstream support covers the target.

Evidence: hash output `____`, license files `____`, upstream support link and
date `____`, result `____`.

### A3. Compiled-runtime proof (existing tooling)

Steps: follow [README.md](README.md) exactly ("Prepare on the Windows build
machine", then "Run on the actual target") and run `run.mjs` with `--api`,
`--node-archive`, `--mongo-archive`, `--output` (new file) and `--commit`.

Expected: exit code 0 and a new evidence JSON. It covers native argon2
(A4), authenticated transactions (A5), anonymous refusal and HTTP
login/profile through the compiled API.

Evidence: exit code `____`, evidence JSON path and SHA-256 `____`, console
output `____`, result `____`. A failure: record the fixed failure message
`____` and do not retry over the same output file.

### A4. Native password verification

Steps: read the A3 evidence JSON assertions for the default native argon2
hash, correct-password accept and wrong-password refuse, and its password
duration.

Expected: all three assertions true; duration recorded.

Evidence: assertion values `____`, native password duration (ms) `____`, result `____`.

### A5. Authenticated MongoDB transactions

Steps: read the A3 evidence for authenticated writable replica-set primary,
anonymous read refusal, transaction commit and rollback.

Expected: all true.

Evidence: assertion values `____`, result `____`.

### A6. Hardware measurements (4 GB RAM target)

The owner's 4 GB figure is a target to qualify, not a proven minimum. A3's
memory samples alone are not a hardware measurement.

Steps:

1. On a 4 GB PC (or a 4 GB, 2+ vCPU VM plus the expected low-end PC), start
   the proof stack (and later the installed package) with Chrome open on the app.
2. Record Task Manager / `Get-Counter '\Memory\Available MBytes','\Processor(_Total)\% Processor Time'`
   at idle, during a 200-line checkout, a sales report and a stock count.
3. Record cold start time to a working login, and disk free space before and after.

Expected: no paging stalls or failures; timings acceptable to the owner.

Evidence: idle available MB `____`, peak commit/available MB `____`, CPU %
peak `____`, cold start (s) `____`, checkout time (s) `____`, report time (s)
`____`, disk delta `____`, observations/limitations `____`, result `____`.

## Part B: later #366 package checks

**Not runnable until #358–#365 deliver an installer.** No proof script exists
for these yet; record "no tool yet" rather than improvising one. Each needs
the installed package version `____` and Chrome version `____`.

| #   | Check                           | Steps                                                                                                                      | Expected                                                 | Evidence      |
| --- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------- |
| B1  | Clean install                   | Fresh Windows 11 x64, no dev tools; run installer offline; first ADMIN login with temporary password, forced change.       | Services start; login works; password change required.   | `____` `____` |
| B2  | Reboot                          | Reboot; do not log in to Windows; then open Chrome.                                                                        | Services up before login; data intact.                   | `____` `____` |
| B3  | Offline, local API reachable    | Disconnect internet; open/close shift, search, tracked checkout, manager approval, reversal, inventory, reports, settings. | All work under existing role rules.                      | `____` `____` |
| B4  | Real API outage/recovery        | Stop the API service mid-session; collect permitted offline cash; restart; retry a lost-response checkout.                 | Refusals as designed; queue syncs; no duplicate receipt. | `____` `____` |
| B5  | Authenticated transactions      | On the installed DB: anonymous connection refused; a sale and a rolled-back failure behave atomically.                     | Auth required; no partial writes.                        | `____` `____` |
| B6  | LAN refusal                     | From another LAN device, connect to the PC's IP on the app/API/DB ports.                                                   | All refused/unreachable.                                 | `____` `____` |
| B7  | Replacement restore             | Back up/export; restore onto a second clean installation with the protected restore tool.                                  | Data and logins restored; confirmation required.         | `____` `____` |
| B8  | Populated / interrupted upgrade | Upgrade a populated earlier package; repeat, interrupting it (power/kill); follow documented recovery.                     | Data kept; recovery documented and works.                | `____` `____` |
| B9  | Stale browser assets            | Keep a tab open from the old version across the upgrade; reload.                                                           | Old service worker replaced; no broken app.              | `____` `____` |
| B10 | Pending receipt preservation    | Leave queued offline cash receipts in Chrome before upgrade/repair/reinstall.                                              | Receipts preserved and later synced exactly once.        | `____` `____` |

Evidence columns: result PASS/FAIL, then screenshots/log file paths.

## Sign-off

Reviewer `____`, date `____`. Only a fully filled Part A with PASS results and
independent review may close #357; Part B belongs to #366.
