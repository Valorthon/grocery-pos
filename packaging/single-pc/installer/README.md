# Single-PC installer and service lifecycle (#362)

Offline bundle builder, installer, repair, uninstall and the daily-use
shortcut for the single-PC edition. It consumes the runtime interface
([../runtime/](../runtime/README.md), #360), the first-administrator command
(#361) and the backup commands ([../backup/](../backup/README.md), #363); it
does not reimplement them.

**Status:** the bundle builder runs on Linux (a real bundle was built from the
pinned components) and the installer's orchestration is tested against a
recording context. **No Windows 11 execution yet.** Service registration,
virtual accounts, ACLs, Task Scheduler, certutil trust in Chrome, shortcuts,
reboot, crash recovery and LAN checks are unproven until the #357/#366 run
(see "Windows-only proof").

## Why PowerShell + Node, not MSI or Inno Setup

- Windows PowerShell 5.1 ships with Windows 11 and the bundle already ships
  Node, so the installer adds no tool, runtime or license to the distribution
  obligations in [../ARCHITECTURE.md](../ARCHITECTURE.md).
- The logic lives in Node modules: `plan.mjs` (pure, every command and
  definition) and `install.mjs` (orchestration through an injectable
  context), so most of it is tested on Linux in CI. `Install.ps1` only checks
  elevation and the manifest hash, copies `node.exe` and the scripts into an
  admin-only folder, verifies them there and starts `install.mjs` from the copy.
- The vendor installs and updates manually (#357), so an MSI's Add/Remove
  Programs entry, per-user advertising or GUI wizard brings nothing that is
  required. WiX (MS-RL) or Inno Setup (own license) would add a build tool and
  a second place where the install logic lives. This can be revisited if the
  owner wants an Add/Remove Programs entry or signed installer.

## Building a bundle (vendor build machine, online)

```bash
pnpm install --frozen-lockfile
node packaging/single-pc/installer/bundle.mjs --out <new folder> [--cache <dir>] [--offline]
```

1. Each component in [../components.json](../components.json) with a
   `bundle` entry is fetched from its pinned https URL (or the cache) and
   refused on any SHA-256 mismatch; a tampered cache is refused, never
   replaced. Caddy 2.11.9's archive was matched against the upstream SHA-512
   checksums file; WinSW 2.12.0 publishes no checksum, so its SHA-256 was
   recorded from the release asset (2026-11-14).
2. Archives are read by a small built-in ZIP reader (`zip.mjs`, no ZIP64,
   unsafe paths refused) and mapped onto `releaseLayout`: `node\`,
   `mongodb\bin\{mongod,mongodump,mongorestore}.exe`, `caddy\caddy.exe`,
   `services\WinSW.exe`; license and notice files go to `notices\<component>\`.
3. Contracts, API and the client (`VITE_APP_ENV=single-pc`,
   `VITE_API_URL=/v1`) are built from the checkout. The API's production
   dependencies come from pnpm 10.33.0's lockfile-backed `pnpm deploy --prod`
   with the hoisted linker (real folders, no symlinks), plus `apps/api/dist`.
   Before building and deploying, a frozen, lockfile-only install validates
   the checkout's manifests, workspace settings and overrides. An absent or
   stale lockfile refuses the build. `injectWorkspacePackages` enables the
   supported deploy path; `syncInjectedDepsAfterScripts: [build]` refreshes
   built contracts before consumers run. Deploy derives a dedicated lockfile
   from the committed workspace lockfile and frozen-installs its exact
   versions, integrities and peer resolutions, without re-resolving ranges.
   Native addons
   must be Windows x64 prebuilds (argon2); other platforms' prebuilds are
   removed.
4. The packaging scripts (no tests), `Caddyfile`, `help\RECOVERY.md`,
   `help\HANDOVER.md` (the owner guide, #366), `notices\COMPONENTS.md`
   (versions, licenses, sources, archive hashes, the MongoDB SSPL source
   location), `api-dependencies.json`, `client-dependencies.json` and
   `VERSION.json` are added.
5. `bundle-manifest.json` lists the SHA-256 of every file, and `SHA256SUMS`
   repeats it for `sha256sum -c`. The bundle is built in `<out>.partial` and
   renamed only when complete; an existing folder is never overwritten.
6. The builder prints `bundle-manifest.json SHA-256: <hash>` (also in its
   JSON result). The manifest travels with the files it describes, so on its
   own it only detects corruption, not tampering. The vendor records that
   hash outside the bundle (build log, release notes, a note kept apart from
   the USB stick) and passes it to `Install.ps1 -ManifestSha256`, which
   refuses any other manifest. Code signing (Authenticode on the scripts and
   executables) is deferred; until then this out-of-band hash is the trust
   anchor.

The store PC downloads nothing: everything the installer needs is in the
bundle.

## Installing (store PC, elevated Windows PowerShell)

```powershell
# First compare by eye: (Get-FileHash .\bundle-manifest.json).Hash with the recorded hash.
.\Install.ps1 -ManifestSha256 <hash> -Mode install -AdminUsername <name> [-StoreTimezone Asia/Manila] [-BackupTime 22:00] [-LanIp 192.168.1.10]
.\Install.ps1 -ManifestSha256 <hash> -Mode repair [-BackupTime HH:MM] [-LanIp <IPv4>|none]
.\Install.ps1 -ManifestSha256 <hash> -Mode uninstall [-RemoveCaTrust]
.\Install.ps1 -ManifestSha256 <hash> -Mode handover-done
.\Install.ps1 -ManifestSha256 <hash> -Mode restore-verify -From <full path of a backup folder>
.\Install.ps1 -ManifestSha256 <hash> -Mode restore -From <full path> -Confirm <backup id> [-AcceptOpenShifts] [-AcceptNewerSales] [-AcceptPendingOffline]
```

`restore` and `restore-verify` (#366) run `backup\restore.mjs` and
`backup.mjs verify` on the data root `%ProgramData%\Valorthon\GroceryPOS`
with `node`, `mongod`, the Database Tools and the API driver from the same
verified admin-only copy as every other mode (the copy also holds the
release's `mongodb\` and `api\`, each file hashed). `-From` must be a full
path; `-Confirm` and the `-Accept…` flags go with `restore` only.

Exit codes: 0 done, 1 failed (nothing removed, re-run resumes), 2 usage,
3 refused (nothing changed).

| Location                                                  | Contents                                                                |
| --------------------------------------------------------- | ----------------------------------------------------------------------- |
| `%ProgramFiles%\Valorthon\GroceryPOS\releases\<version>\` | verified release, never written after install                           |
| `%ProgramFiles%\Valorthon\GroceryPOS\services\`           | WinSW wrapper copies and their XML                                      |
| `%ProgramFiles%\Valorthon\GroceryPOS\tasks\`              | generated Task Scheduler XML                                            |
| `%ProgramData%\Valorthon\GroceryPOS\`                     | data root (#360), plus `state\installer.json`                           |
| `%ProgramData%\Valorthon\GroceryPOS-Handover\`            | first administrator's temporary password (SYSTEM + Administrators only) |

`Install.ps1` never runs anything from the bundle folder, which may be
user-writable (USB stick, Downloads): it checks the manifest's SHA-256
against `-ManifestSha256`, copies `release\node` and `release\tools` into a
fresh `%ProgramFiles%\Valorthon\GroceryPOS\installer-run-<guid>` (only
administrators and SYSTEM can write there), refuses any unlisted file,
verifies every hash there, writes the manifest bytes it checked into the
same folder and runs `install.mjs` from that copy with `--manifest <copy>
--manifest-sha256 <hash>`, then deletes it. `install.mjs` never reads the
bundle's own manifest: it re-checks its copy against the hash, verifies the
bundle's release files against it, and verifies every file again at the
destination after copying (a file swapped in between is refused and nothing
is installed).

Steps (each idempotent; `state\installer.json` records the stages):

1. **Verify** the whole bundle against its manifest.
2. **Preflight**, before anything is written: Windows 11 (build ≥ 22000,
   client edition), x64 OS architecture (`RuntimeInformation`, so x64
   emulation on ARM is refused), elevated, .NET Framework ≥ 4.6.1 (WinSW
   NET461), free space (twice the release; 5 GB on the data volume,
   provisional), ports 1443/13000/27018 free unless held by our own installed
   services (a listener whose executable is not under our `releases\` is
   refused even then, `Get-NetTCPConnection`), and the data root's state: new, ours (reinstall) or foreign
   (refused). A missing Chrome is a warning. With a LAN IP (#396): the
   address must be on a local adapter (`Get-NetIPAddress -AddressState
Preferred`, so a conflicting address is not present) and port 1443 free
   on it unless our proxy holds it. A new or changed IP that is missing is
   refused; the kept IP missing (cable out, router off) is only a warning,
   so repair, upgrade and rollback still run. Public on any adapter holding
   it, or the IP on several adapters, is a warning (the firewall rule is
   Private-only). `install` with services
   already registered is refused ("use repair"); `repair` needs an existing
   installation.
3. **Lock** (`installer.lock`, the provisioning lock implementation).
4. **Stop** our services (proxy → API → MongoDB) through the Service Control
   Manager, waiting for STOPPED.
5. **Release**: copied to `<version>.partial`, verified, renamed. An
   unchanged existing copy is kept; a changed one is moved to
   `<version>.damaged-<time>` and replaced.
6. **Provision** (`provision()` from #360): data root, secrets (never
   regenerated), authenticated replica set, `api.env`.
7. **Services**: any existing registration is deleted and the installer
   waits (60 s at most) until the Service Control Manager has actually removed
   it (`sc delete` only marks it; registering again too early fails with
   1072), then MongoDB
   (`mongod --install`), API and proxy (WinSW) are registered in dependency
   order. Each runs as its own virtual account `NT SERVICE\<name>`
   (`sc sidtype unrestricted`, `sc config obj=`), automatic start, with
   `depend=` on the previous one, and SCM recovery 10 s / 30 s / 60 s (reset
   after 1 h, `failureflag 1`). ACLs are granted per the runtime README
   table, then the services are started in order and each waits for real
   readiness (MongoDB port, API `/v1/health/ready`, proxy over HTTPS with
   Caddy's root). The Windows Firewall rule `GroceryPOS-LAN-HTTPS` is
   deleted and, with a LAN IP, added again for this release's `caddy.exe`:
   inbound TCP 1443 on the LAN IP only, `remoteip=localsubnet`,
   `profile=private` (#396).
8. **Trust**: waits for Caddy's internal root
   (`tls\data\caddy\pki\authorities\local\root.crt`) and adds it to the
   machine Root store (`certutil -addstore -f Root`), which Chrome on
   Windows uses; then checks the proxy with system trust.
9. **First administrator** (#361): the handover folder is created with
   inheritance removed and only SYSTEM and Administrators granted, then
   `node --env-file=secrets\api.env initial-admin.cli.js --username <name>
--generate-password-file <handover>\initial-admin-password.txt`. A file left
   by an interrupted run is reused with `--password-file`, never replaced.
   Exit 3 (already initialized) is normal on repair/reinstall.
   `READ-ME-FIRST.txt` beside it names the user and the steps. The installer
   never deletes the password file by itself: `-Mode handover-done` deletes
   the folder (refusing if it holds anything else) once the owner has
   changed the password.
10. **Tasks** (UTF-16 XML, `schtasks /Create /XML /F`):
    `\GroceryPOS\Daily backup` runs `backup.mjs create --kind scheduled` as
    SYSTEM daily at the backup time (default 22:00), `StartWhenAvailable`
    (a missed run happens at next boot), 2 h limit, 3 retries 30 min apart;
    `\GroceryPOS\Weekly export reminder` shows a message to the logged-on
    user (Users group, least privilege) every Monday 09:00, pointing to the
    "Back up to USB drive" shortcut (owner decisions 2026-11-15);
    `\GroceryPOS\Nightly log rotation` runs `diagnose.mjs rotate-logs` as
    SYSTEM 30 minutes after the backup time (default 22:30),
    `StartWhenAvailable`, 10 min limit: it rotates `mongod.log` and keeps
    the newest 5 rotated files, nothing else (owner decision 2026-11-15,
    #365).
    Shortcuts "Check Grocery POS" (Public Desktop + common Start menu,
    `CheckHealth.ps1`: elevation prompt, partial check if declined, the
    plain-language result, "Open help" and "Save support file…") and
    "Grocery POS help" (common Start menu, the release's
    `help\RECOVERY.md` in Notepad) are created with the others (owner
    decisions 2026-11-15, see [../diagnostics/](../diagnostics/README.md)).
    "Grocery POS owner guide" (common Start menu, next to the help entry,
    the release's `help\HANDOVER.md` in Notepad; owner decision, #366).
11. **Shortcut** "Grocery POS" on the Public Desktop and the common Start
    menu: hidden `powershell.exe -File Launch.ps1`, which polls
    `https://localhost:1443/v1/health/ready` (TLS 1.2, up to 180 s) and only
    then opens Chrome (`App Paths\chrome.exe`) with `--new-window`; otherwise
    it explains what to do. It never changes a Chrome profile.
12. **Shortcut** "Back up to USB drive" in the same two places (owner
    decision 2026-11-15): `BackupToUsb.ps1 -DataRoot <root> -Release
<release>` asks for elevation (the Windows UAC prompt; the person needs an
    administrator account of this PC), lists the drives the export
    accepts (`usb-drives.mjs`, which applies `removable.mjs`'s rule per
    lettered volume: USB/SD/MMC/1394 bus or removable type, never the
    boot/system disk or the installation disk, so USB hard disks and SSDs
    are listed) to pick one, runs `backup.mjs create --kind
manual` and then `backup.mjs export --to <drive>` (#363 interfaces; the
    export itself refuses non-removable drives), and shows a plain success
    or failure message. Only `backup.mjs`'s own fixed `Refused:`/`Failed
[CODE]:` lines are shown, never one that looks like a connection string or
    credential (`report()` never prints driver text or `detail`).
13. **Old releases**: after a successful install or repair, `releases\`
    keeps the current release and the newest other complete one (for
    rollback by #364); older releases and every `*.damaged-*` and
    `*.partial` copy are deleted.

## Repair, interrupted runs, reinstall and uninstall

- Upgrades are `-Mode upgrade` (with `upgrade-rollback` and
  `upgrade-status`), which run the bundle's `tools\upgrade\upgrade.mjs`
  from the same verified copy ([../upgrade/](../upgrade/README.md), #364).
  `repair` with a bundle of another version than the installed one is
  refused: data migrations and the pre-upgrade backup belong to the
  upgrade tool.

- An interrupted run (power cut, crash) leaves no partial release under the
  real name, no regenerated secret and no second admin. Re-running the same
  mode resumes; provisioning resumes from its own journal.
- `repair` re-verifies/replaces the release, re-provisions, re-registers
  services, ACLs, tasks and shortcuts, keeps the admin and secrets.
- LAN terminals (#396, ARCHITECTURE.md "LAN terminals (#402)"): `-LanIp
<private IPv4>` on install or repair serves the app on
  `https://<IP>:1443` as well as `https://localhost:1443`. It is stored in
  `state\installer.json` and `config\runtime.json`, written as the API's
  `LAN_ORIGIN` (#394), and served by its own service `GroceryPOS-ProxyLan`
  (owner decision 2026-11-20) running `caddy\Caddyfile.lan` (`bind <IP>`
  only, health refused), registered after and depending on
  `GroceryPOS-Proxy`, sharing `tls\data`. If the address is missing (cable
  out, router off) only that service fails and SCM keeps retrying it;
  `https://localhost:1443` keeps working, and the installer warns instead
  of waiting for it. `-LanIp none` and uninstall remove the service. Repair and upgrade keep it;
  `-LanIp none` turns it off. A different IP is a new origin (each
  terminal's queued offline cash lives in the old origin's browser
  storage), so repair refuses the change while a shift is open or an
  offline lease is active, checked before anything stops and again once
  the proxy and API are stopped (they are restarted on a refusal). An
  install over an existing data root (a reinstall, or a restored one) keeps
  its stored IP and refuses `-LanIp` naming another: change it afterwards
  with `-Mode repair -LanIp`. `-LanIp` is refused in upgrade modes; the
  upgrade keeps the IP and warns in preflight if it is absent.
- Joining a Windows terminal (#397): the common Start menu shortcut
  "Make terminal package" (`MakeTerminalPackage.ps1`, elevated) runs
  `terminal.mjs package --data-root <dir> --to <folder>` into a folder the
  owner picks. It writes `GroceryPOS-terminal-<IP>\` with the public Caddy
  root `root.crt` (never the key), `terminal.json` (server URL, the root's
  SHA-256 and SHA-1 thumbprint), `JoinTerminal.ps1` and `README.txt`;
  without a LAN IP it is refused. On the terminal (no services, no Node),
  an administrator runs `JoinTerminal.ps1 -Mode join|rejoin|leave`
  (`joinPlan` in `terminal.mjs` is its tested specification): join checks
  the root's SHA-256 first, `certutil -addstore -f Root`, records the
  thumbprint in `%ProgramData%\Valorthon\GroceryPOS-Terminal\terminal.json`,
  points Windows time at the main PC (`w32time` automatic,
  `w32tm /config /manualpeerlist:<IP>,0x8 /syncfromflags:manual /update`,
  then `/resync /force`; a failed resync is only a warning), creates the "Grocery POS" Chrome shortcut
  to `https://<IP>:1443/` (Public Desktop + common Start menu) and checks
  TLS with a plain `GET` of the site root (never `/v1/health*`). Before
  trusting, it loads `root.crt` as a certificate and refuses unless its
  own thumbprint equals `terminal.json`'s and it is a CA; it prints the
  thumbprint to compare with the one "Make terminal package" showed
  (display only). Join with a
  different recorded root is refused; rejoin deletes the old root by its
  recorded thumbprint (never by name: every Caddy root has a similar CN)
  first. Leave deletes only the recorded root and the shortcut; Windows
  time keeps its setting. Windows execution is pending (#401).
- Time server (#398): with a LAN IP, install/repair make the main PC the
  terminals' clock: `W32Time\TimeProviders\NtpServer\Enabled=1`,
  `w32tm /config /reliable:yes /update` (AnnounceFlags 5, so the isolated
  main PC serves time while unsynced), w32time start type automatic with
  its triggers removed (`sc triggerinfo w32time delete`), restarted; and
  the firewall rule `GroceryPOS-LAN-NTP` (inbound UDP 123, localip the LAN
  IP, `remoteip=localsubnet`, Private profile), deleted first on every run
  and not recreated without a LAN IP. A terminal polls between
  `MinPollInterval` and `MaxPollInterval` (standalone defaults 2^10 s, about
  17 minutes, to 2^15 s, about 9 hours). Windows refuses a correction larger
  than `MaxPosPhaseCorrection`/`MaxNegPhaseCorrection` (standalone default
  54000 s, 15 hours): a terminal off by more must have its date and time
  set by hand first, then `JoinTerminal.ps1 -Mode rejoin`.
- Upgrade does not apply the time-server or firewall steps: after upgrading
  a LAN-enabled site from a release before #398, run `repair` once.
- `uninstall` stops and deletes our services (and the LAN proxy), deletes our tasks,
  the LAN firewall rules (`GroceryPOS-LAN-HTTPS`, `GroceryPOS-LAN-NTP`), shortcuts, releases, wrappers and task XML. It **keeps** the data root
  (database, secrets, TLS state, backups, logs, installer state), the
  handover folder, the CA trust (unless `-RemoveCaTrust`, which removes our
  root by serial) and every Chrome profile. It never touches Chrome, .NET,
  PowerShell or any other software.
- Installing again over a kept data root is a reinstall: same secrets, same
  database, the first administrator already exists.

## Verification

Portable, in CI (`pnpm test:single-pc-proof`, `installer.test.mjs` and
`deployment.test.mjs`): ZIP
reader and path safety; component pins; download/cache SHA-256 refusal;
archive → release mapping; Windows-only native addons; a complete bundle
with manifest, `SHA256SUMS`, notices and tamper detection (changed, missing,
unexpected files); no partial bundle after a failure; preflight decisions;
handover location; service order, virtual accounts, dependencies and
recovery; ACL grants against the runtime README table; task definitions;
shortcuts; release pruning; foreign listeners; the Install.ps1 staged
copy (static); uninstall scope; and a full install → interrupted install →
resume → repair → damaged-release repair → uninstall → reinstall →
handover cleanup run against a recording context, with secrets unchanged.
PowerShell scripts get static checks only (no `pwsh` in CI).

The deployment regression starts an isolated localhost npm registry, locks
1.0.0, then publishes an allowed 1.1.0. Real pnpm deployment with an empty
store and again with the populated store must produce the same production
inventory at 1.0.0, preserve registry integrity hashes, overrides and peer
bindings, include built workspace contracts, exclude development packages
and contain no symlinks. Changing a manifest without its lockfile must fail.
See [deployment-evidence.md](deployment-evidence.md) for the investigation
of the previous legacy deployment. Actual Windows acceptance stays in #366.

Manually on Linux (2026-11-14): a real bundle from the pinned archives
(all six SHA-256 matched, 13,303 files, about 325 MB), `sha256sum -c
SHA256SUMS` passing and `readBundle` verifying it.

### Windows-only proof (not yet done)

On an eligible Windows 11 x64 PC (#357/#366): `Install.ps1` parse and run;
preflight on Windows 10/ARM/Server/busy port/low disk; `mongod --install` and
WinSW registration under `NT SERVICE\*` with the ACLs (services start, nothing
else can read `secrets\`); start order and readiness; graceful stop (mongod
clean shutdown in its log, Nest shutdown hooks); kill each service process
and watch recovery; reboot before login; Chrome opens without a certificate
warning; the shortcut as a standard (non-admin) user; non-admin daily use;
the backup task as SYSTEM writing a verified backup; the reminder; "Back up
to USB drive" with a USB stick, without a drive and with a full drive; the
handover folder's ACL (a standard user is denied); interrupted install
(power off during provisioning and during copy); repair; uninstall and
reinstall keeping records and settings; and no LAN listener
(`Get-NetTCPConnection`, a second PC). Record them with the
[../acceptance/RUNBOOK.md](../acceptance/RUNBOOK.md) terms.

Known gaps: mongod's 60 s stop wait (the runtime README) is not configurable
through `sc`; Windows' service stop wait applies until #366 measures it.
`Launch.ps1` and `BackupToUsb.ps1` start through `powershell.exe
-WindowStyle Hidden`, which still flashes a console briefly (PowerShell 5.1).
