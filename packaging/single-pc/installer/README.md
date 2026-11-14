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
  elevation, verifies `node.exe` and the scripts against the manifest, and
  starts `install.mjs`.
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
   dependencies come from `pnpm deploy --prod --legacy` with the hoisted
   linker (real folders, no symlinks), plus `apps/api/dist`. Native addons
   must be Windows x64 prebuilds (argon2); other platforms' prebuilds are
   removed.
4. The packaging scripts (no tests), `Caddyfile`, `notices\COMPONENTS.md`
   (versions, licenses, sources, archive hashes, the MongoDB SSPL source
   location), `api-dependencies.json`, `client-dependencies.json` and
   `VERSION.json` are added.
5. `bundle-manifest.json` lists the SHA-256 of every file, and `SHA256SUMS`
   repeats it for `sha256sum -c`. The bundle is built in `<out>.partial` and
   renamed only when complete; an existing folder is never overwritten.

The store PC downloads nothing: everything the installer needs is in the
bundle.

## Installing (store PC, elevated Windows PowerShell)

```powershell
.\Install.ps1 -Mode install -AdminUsername <name> [-StoreTimezone Asia/Manila] [-BackupTime 22:00]
.\Install.ps1 -Mode repair [-BackupTime HH:MM]
.\Install.ps1 -Mode uninstall [-RemoveCaTrust]
.\Install.ps1 -Mode handover-done
```

Exit codes: 0 done, 1 failed (nothing removed, re-run resumes), 2 usage,
3 refused (nothing changed).

| Location                                                  | Contents                                                                |
| --------------------------------------------------------- | ----------------------------------------------------------------------- |
| `%ProgramFiles%\Valorthon\GroceryPOS\releases\<version>\` | verified release, never written after install                           |
| `%ProgramFiles%\Valorthon\GroceryPOS\services\`           | WinSW wrapper copies and their XML                                      |
| `%ProgramFiles%\Valorthon\GroceryPOS\tasks\`              | generated Task Scheduler XML                                            |
| `%ProgramData%\Valorthon\GroceryPOS\`                     | data root (#360), plus `state\installer.json`                           |
| `%ProgramData%\Valorthon\GroceryPOS-Handover\`            | first administrator's temporary password (SYSTEM + Administrators only) |

Steps (each idempotent; `state\installer.json` records the stages):

1. **Verify** the whole bundle against its manifest.
2. **Preflight**, before anything is written: Windows 11 (build ≥ 22000,
   client edition), x64 OS architecture (`RuntimeInformation`, so x64
   emulation on ARM is refused), elevated, .NET Framework ≥ 4.6.1 (WinSW
   NET461), free space (twice the release; 5 GB on the data volume,
   provisional), ports 1443/13000/27018 free unless held by our own installed
   services, and the data root's state: new, ours (reinstall) or foreign
   (refused). A missing Chrome is a warning. `install` with services
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
7. **Services**: any existing registration is deleted, then MongoDB
   (`mongod --install`), API and proxy (WinSW) are registered in dependency
   order. Each runs as its own virtual account `NT SERVICE\<name>`
   (`sc sidtype unrestricted`, `sc config obj=`), automatic start, with
   `depend=` on the previous one, and SCM recovery 10 s / 30 s / 60 s (reset
   after 1 h, `failureflag 1`). ACLs are granted per the runtime README
   table, then the services are started in order and each waits for real
   readiness (MongoDB port, API `/v1/health/ready`, proxy over HTTPS with
   Caddy's root).
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
    user (Users group, least privilege) every Monday 09:00.
11. **Shortcut** "Grocery POS" on the Public Desktop and the common Start
    menu: hidden `powershell.exe -File Launch.ps1`, which polls
    `https://localhost:1443/v1/health/ready` (TLS 1.2, up to 180 s) and only
    then opens Chrome (`App Paths\chrome.exe`) with `--new-window`; otherwise
    it explains what to do. It never changes a Chrome profile.

## Repair, interrupted runs, reinstall and uninstall

- An interrupted run (power cut, crash) leaves no partial release under the
  real name, no regenerated secret and no second admin. Re-running the same
  mode resumes; provisioning resumes from its own journal.
- `repair` re-verifies/replaces the release, re-provisions, re-registers
  services, ACLs, tasks and shortcuts, keeps the admin and secrets.
- `uninstall` stops and deletes our three services, deletes our two tasks,
  shortcuts, releases, wrappers and task XML. It **keeps** the data root
  (database, secrets, TLS state, backups, logs, installer state), the
  handover folder, the CA trust (unless `-RemoveCaTrust`, which removes our
  root by serial) and every Chrome profile. It never touches Chrome, .NET,
  PowerShell or any other software.
- Installing again over a kept data root is a reinstall: same secrets, same
  database, the first administrator already exists.

## Verification

Portable, in CI (`pnpm test:single-pc-proof`, `installer.test.mjs`): ZIP
reader and path safety; component pins; download/cache SHA-256 refusal;
archive → release mapping; Windows-only native addons; a complete bundle
with manifest, `SHA256SUMS`, notices and tamper detection (changed, missing,
unexpected files); no partial bundle after a failure; preflight decisions;
handover location; service order, virtual accounts, dependencies and
recovery; ACL grants against the runtime README table; task definitions;
shortcut; uninstall scope; and a full install → interrupted install →
resume → repair → damaged-release repair → uninstall → reinstall →
handover cleanup run against a recording context, with secrets unchanged.
PowerShell scripts get static checks only (no `pwsh` in CI).

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
the backup task as SYSTEM writing a verified backup; the reminder; the
handover folder's ACL (a standard user is denied); interrupted install
(power off during provisioning and during copy); repair; uninstall and
reinstall keeping records and settings; and no LAN listener
(`Get-NetTCPConnection`, a second PC). Record them with the
[../proof/ACCEPTANCE-CHECKLIST.md](../proof/ACCEPTANCE-CHECKLIST.md) terms.

Known gaps: mongod's 60 s stop wait (the runtime README) is not configurable
through `sc`; Windows' service stop wait applies until #366 measures it.
Old releases are left in place for the upgrade work (#364).
