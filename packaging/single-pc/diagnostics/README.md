# Single-PC diagnostics (#365)

A local, read-only check of the installation ([diagnose.mjs](diagnose.mjs))
with plain recovery steps for every failure, plus a database log rotation
command. Recovery steps in full: [RECOVERY.md](RECOVERY.md).

**Status:** exercised on Linux with a real MongoDB 7.0.48 (below). No Windows
11 execution yet; see "Windows-only proof".

Owner decisions applied (#357/#365): the store owner may view basic
diagnostics (service status, disk space, last verified backup); restore stays
the separate protected tool ([../backup/restore.mjs](../backup/README.md));
no LAN administration endpoint, no automatic support upload, no telemetry, no
external notification. The tool talks only to loopback and sends nothing
anywhere.

## Commands

Run with the release's own `node.exe`
(`%ProgramFiles%\Valorthon\GroceryPOS\releases\<version>\node\node.exe`); the
tool ships at `releases\<version>\tools\diagnostics\diagnose.mjs`.

```text
node diagnose.mjs check --data-root <abs> [--release <abs>] [--api <release>\api] [--json]
node diagnose.mjs rotate-logs --data-root <abs> --api <release>\api [--keep 5]
```

`check` exits 0 when everything is OK, 1 when something needs attention and
2 on a usage error. `--release` defaults to the installer's record
(`state\installer.json`). `--json` prints the same report as JSON on the
console (nothing is written to disk). An administrator sees everything; a
standard account sees what its permissions allow (the certificate and the
backup status are admin-only on Windows) and the result says so instead of
guessing.

`rotate-logs` is maintenance, not owner diagnostics: it reads the MongoDB root
password, so it runs elevated or as SYSTEM. It asks mongod to rotate
(`logRotate`, `mongod.cfg`'s `logRotate: rename`) and keeps the newest
`--keep` rotated `mongod.log.<time>` files.

## What `check` covers

| Check                | How                                                                                                                                                                                                                  | Never                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Installed version    | `state\installer.json` (version, release, complete) and the release's `VERSION.json` (app version, commit, build time, component versions)                                                                           | prints the installer's admin username        |
| Services             | `sc.exe query` for `GroceryPOS-MongoDB`, `-API`, `-Proxy` (Windows only; "unknown" elsewhere)                                                                                                                        | starts or stops a service                    |
| Ports                | TCP connect to 127.0.0.1:27018, 127.0.0.1:13000, 127.0.0.1:1443 and [::1]:1443; listener addresses (`Get-NetTCPConnection`, `/proc/net` on Linux) must all be loopback, else FAIL                                    | listens itself                               |
| Database             | unauthenticated `hello` on 127.0.0.1:27018: replica set `gpos` and writable primary                                                                                                                                  | reads `secrets\` or any collection           |
| Application          | `GET http://127.0.0.1:13000/v1/health/live` and `/ready` (exempt from the Host check, #358): "not running" vs "running but cannot use the database" (ready proves the API's MongoDB sign-in) vs memory/disk pressure | signs in to the app                          |
| Browser address      | `GET https://localhost:1443/v1/health/ready` through Caddy, TLS verified against Caddy's local root (`tls\data\…\root.crt`), root expiry                                                                             | skips verification when the root is readable |
| Disk space           | free space on the data and program volumes: FAIL at ≥ 90 % used (the API's own live threshold), WARN under 5 GB free (`MIN_FREE`, provisional until #357)                                                            |                                              |
| Backups              | [`readStatus`/`statusSummary`](../backup/backup.mjs) over `backups\status.json` (#363): last attempt, success, verified success, failure code, consecutive failures, overdue (36 h), USB export reminder (7 days)    | infers success from backup folders or files  |
| Clock                | PC time must not be behind the last recorded installer stage or backup status update; shows the Windows time zone (the store's own is in Store settings)                                                             | contacts a time server                       |
| Logs and last errors | sizes, and the last 5 error lines each from `logs\mongod.log` (JSON `s: E/F`), `logs\api\` and `logs\proxy\`, read from their last 256 KB and redacted                                                               | prints whole logs                            |

Redaction (`redact`): connection-string credentials, `password`/`secret`/
`token`/`cookie`/`authorization`/`pin`/`DATABASE_URL`-style values, Bearer
tokens, JWTs, any 40+ character base64 run (generated secrets are 64),
e-mail addresses and the user name in `C:\Users\<name>` / `/home/<name>`
paths. Request ids (UUIDs) stay so a vendor can match a failure. Each line is
capped at 400 characters.

Not observed: pending offline cash receipts live in each browser's IndexedDB
(#37), and a server-side lease count needs database credentials, so the report
points to the register screen instead (normal close already requires them
synchronized).

## Logs are bounded

- API and proxy: WinSW rolls `logs\api\` and `logs\proxy\` at 10 MB × 5
  ([../runtime/layout.mjs](../runtime/layout.mjs) `winswXml`). The API logs a
  request id per request and no bodies, cookies or query strings (#8, #94).
- MongoDB: `logs\mongod.log` grows until rotated; `rotate-logs` rotates and
  prunes it, and `check` warns above 100 MB. Scheduling `rotate-logs` (for
  example after the nightly backup) is an installer change not made here; see
  the PR.

## What it does not do

It changes nothing (apart from `rotate-logs`), opens no port, needs no
application role and grants none, writes no file, uploads nothing and sends
no notification. A support export file (bundle) is **not** implemented: its
content and access need the owner's decision first (#365). Until then a
vendor can read the on-screen report with the owner.

## Verification

```bash
pnpm test:single-pc-proof            # portable unit tests (fake context)
GPOS_TEST_MONGOD=/path/to/mongod pnpm test:single-pc-diagnostics
```

The portable tests cover every check's failure and its steps: API down vs
database unusable, database recovering, a non-loopback listener, low and full
disk, backup failure/overdue/never/export reminder from `status.json` (a
backup folder without status is still a failure), an unreadable status file,
a clock behind recorded activity, an incomplete installation, a large
database log, redaction and argument parsing. The real-MongoDB test provisions
an installation (#360), runs the CLI with `secrets\` unreadable (database up,
API down, loopback-only listener, never-backed-up), rotates the log three
times keeping two, then stops mongod and sees the database check fail.

## Windows-only proof (#357/#366)

Not proven on Linux: `sc.exe` service states, `Get-NetTCPConnection`
listener addresses, what a standard (non-admin) account can read under the
installer's ACLs, Caddy's TLS through the real certificate chain, NTFS
`statfs` figures, mongod `logRotate` with `rename` on Windows, WinSW log
rolling, and the exercises #365 asks for on the chosen platform (API down,
DB down, low disk, failed backup, log rotation).
