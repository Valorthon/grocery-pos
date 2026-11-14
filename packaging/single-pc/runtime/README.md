# Single-PC persistent runtime (#360)

The runtime/configuration interface that the installer (#362), backups
(#363), upgrades (#364) and diagnostics (#365) consume. One definition lives
in [layout.mjs](layout.mjs) (pure functions, pinned by `layout.test.mjs`);
[provision.mjs](provision.mjs) creates or verifies an installation. It does
not install services, trust certificates, create Windows service identities
or the first ADMIN: those are #362 and #361.

The dev `docker-compose.yml`/`mongo-init.sh` (no authentication) are never
used here. Cloud/staging defaults are unchanged.

**Status:** exercised on Linux with a real MongoDB 7 `mongod` (below). No
Windows 11 execution yet; see "Windows-only proof".

## Layout

Replaceable binaries, one directory per release (built by #362):
`%ProgramFiles%\Valorthon\GroceryPOS\releases\<version>\` with `node\node.exe`,
`mongodb\bin\mongod.exe`, `api\` (compiled API + production `node_modules`),
`client\` (compiled client), `caddy\caddy.exe` and `caddy\Caddyfile`
(`releaseLayout`).

Persistent data root, `%ProgramData%\Valorthon\GroceryPOS` (`layout`):

| Path                                          | Contents                                                              | POSIX mode |
| --------------------------------------------- | --------------------------------------------------------------------- | ---------- |
| `config\mongod.cfg`                           | mongod configuration (regenerated, no secrets)                        | 0750 dir   |
| `config\runtime.json`                         | non-secret manifest: ports, paths, service names, install id          |            |
| `secrets\mongo-keyfile`                       | replica-set keyfile (756 random bytes, base64)                        | 0700/0600  |
| `secrets\mongo-root-password`                 | `gpos_root` (root role); provisioning/maintenance only                |            |
| `secrets\mongo-api-password`                  | `gpos_api` (readWrite on `grocery` only)                              |            |
| `secrets\jwt-secret`, `cookie-secret`         | distinct 48-byte base64url values                                     |            |
| `secrets\api.env`                             | the API's environment (`node --env-file`), derived from above         |            |
| `database\`                                   | MongoDB dbPath                                                        | 0700       |
| `tls\data`, `tls\config`                      | Caddy `XDG_DATA_HOME`/`XDG_CONFIG_HOME`: internal CA and certs        | 0700       |
| `logs\mongod.log`, `logs\api\`, `logs\proxy\` | service logs                                                          | 0750       |
| `backups\`                                    | reserved for #363                                                     | 0700       |
| `state\install.json`                          | `{schema, installationId, createdAt}`, written once                   | 0700       |
| `state\provision.json`                        | stage journal (`layout`, `secrets`, `database`, `config`, `complete`) |            |
| `state\provision.lock`, `state\mongod.pid`    | present only while a run is active                                    |            |

Secrets are generated with `crypto.randomBytes` on the target, written once
(create-then-link, never overwritten) and never printed, passed as arguments
or put in the release, `config\` or logs. Backups (#363) must carry
`secrets\` and `state\install.json` with the database: without them the
database is unreachable (no reset path exists, by design).

## Ports and binds

| Service             | Name                 | Listens                        |
| ------------------- | -------------------- | ------------------------------ |
| MongoDB 7           | `GroceryPOS-MongoDB` | `127.0.0.1:27018` (IPv6 off)   |
| API (`node`, WinSW) | `GroceryPOS-API`     | `127.0.0.1:13000`              |
| Caddy (WinSW)       | `GroceryPOS-Proxy`   | `127.0.0.1:1443`, `[::1]:1443` |

The browser origin is `https://localhost:1443` (#358). A port that is
already taken is refused, never moved.

## Services

`serviceDefinitions(paths, release)` gives the start order MongoDB → API →
proxy, each depending on the previous one (stop is the reverse), with
executable, arguments, working directory and environment. `winswXml`
renders the API/proxy WinSW 2.x XML: automatic start, restart after 10 s,
30 s, then every 60 s without limit (WinSW repeats the last action; the
failure count resets after 1 hour), so a slow MongoDB recovery after a power
loss cannot leave the API stopped, Ctrl+C
then a 30 s stop timeout (Nest's shutdown hooks run on SIGINT), logs rolled
at 10 MB × 5. MongoDB uses its own Windows service registration
(`mongod --config <config\mongod.cfg> --install --serviceName GroceryPOS-MongoDB`),
which shuts down cleanly on service stop. Stop it only through the Service
Control Manager (`Stop-Service GroceryPOS-MongoDB` / `sc stop`; the
definition's `stop: 'service-control-manager'`), never `taskkill` or
TerminateProcess, which skip the clean shutdown; #362 sets its 60 s stop
wait.

The API runs as `node --env-file=<secrets\api.env> <release>\api\dist\main.js`
with its working directory in the release (which contains no `.env`). The
first ADMIN (#361) is created the same way:
`node --env-file=<secrets\api.env> <release>\api\dist\bootstrap\initial-admin.cli.js …`.

## Readiness, shutdown and health

- **Database ready:** authenticated `hello` answers `isWritablePrimary`.
- **API ready:** in `APP_ENV=single-pc` the API does not listen until the
  database is a writable replica-set primary and every model's indexes are
  built (`apps/api/src/common/startup-readiness.ts`, 120 s, then it exits and
  WinSW restarts it). The initial connection itself also retries for that
  window on single-pc (40 × 3 s, `connectionRetryOptions`) instead of
  Nest's default 9 × 3 s; cloud keeps the default. After that `GET http://127.0.0.1:13000/v1/health/ready`
  (Host-check exempt) reports the DB ping; `/v1/health/live` checks memory
  and disk. A listening port alone is not "ready".
- **Proxy ready:** `GET https://localhost:1443/v1/health/ready`.
- **Health thresholds** (`HEALTH`): heap 300 MB, RSS 400 MB (as deployed),
  disk unhealthy at 90 % full of the volume holding the data root
  (`HEALTH_DISK_PATH`). Disk free-space minimums for install are #362's
  preflight. These are not the 4 GB qualification (#357).
- A single node gives transactions, not high availability.

## Provisioning

```text
node provision.mjs --data-root <abs> --mongod <release>\mongodb\bin\mongod.exe \
    --api <release>\api [--cache-size-gb <n>] [--store-timezone <IANA>]
```

Run with the release's own `node.exe`, as an administrator, before the
services are installed (or with the DB service stopped). Exit 0 ready, 1
failure (nothing reset; re-run resumes), 2 usage, 3 refused (state left as
found). Steps, journaled in `state\provision.json`:

1. **layout:** a non-empty root without our `install.json` is refused
   before anything is written. Then the lock (`state\provision.lock`,
   `<pid> <token>`, created exclusively) is taken, and only under it is an
   absent or empty root turned into a new installation (`install.json`
   written once with `link`, never replaced) or another schema refused. A
   concurrent run is refused. A dead run's lock is taken over by renaming
   it aside first, so of several racing runs exactly one wins; a run that
   moved a live lock puts it back and refuses. A run removes the lock only
   while it still holds its own token.
2. **secrets:** generated once. A secret missing or damaged after this stage
   completed is refused ("restore it from a backup"), never regenerated.
3. **database:** writes `mongod.cfg`, starts a private mongod (if the port is
   free) or reuses one that authenticates as this installation's root and
   carries its installation marker (`gpos_runtime.installation`); anything
   else on the port is refused. With no users yet (fresh or interrupted),
   the localhost exception initiates the replica set `gpos` and creates the
   root user; otherwise root must authenticate. Replica-set name/host, FCV
   7.0 and the installation marker must match. The API user is converged to
   the stored password and `readWrite` on `grocery`.
4. **config:** writes `secrets\api.env` and `config\runtime.json`.

A mongod the run started is shut down at the end with the authenticated
`shutdown` command. If root cannot authenticate, it is signalled instead:
SIGTERM is a clean stop on POSIX, but on Windows it is TerminateProcess
(journal recovery on next start; to be checked in #366). a killed run may leave it
running (its pid is in `state\mongod.pid`): the next run refuses until that
process is stopped, then resumes.

`--cache-size-gb` is unset by default (MongoDB's own default). The value for
the 4 GB target is an open #357 qualification question.

## Maintenance credentials

The API and any one-off maintenance command run with `secrets\api.env`,
i.e. as `gpos_api` (`readWrite` on `grocery`). That covers the existing
data migrations (`migrate:categories`, `migrate:stock-ledger`,
`migrate:decode-entities`): they read and write `grocery` collections and
build indexes, with no `collMod`, `dropIndex` on other databases or admin
commands. They exist for legacy cloud data; a fresh single-PC installation
needs none of them. `gpos_root` is used only by `provision.mjs`; a future
migration that needs more than `readWrite` must get its own credential in
a later change rather than widening `gpos_api`.

## Permissions

POSIX: the data root and private directories are 0700 and secret files
0600 (mongod also requires this of its keyfile). Windows: provisioning
replaces inherited ACLs on each directory with SYSTEM + Administrators full
control (`icacls /inheritance:r`). #362 then grants, per service identity:

| Identity | Access                                                               |
| -------- | -------------------------------------------------------------------- |
| MongoDB  | modify `database\`, `logs\`; read `config\`, `secrets\mongo-keyfile` |
| API      | read `secrets\api.env`; modify `logs\api\`                           |
| Proxy    | modify `tls\`, `logs\proxy\`; read the release `client\`             |

## Verification

Portable: `pnpm test:single-pc-proof` (layout/CLI/refusal tests).

Real MongoDB (Linux; CI's `db` job extracts `mongod` from `mongo:7.0.48`,
the version pinned in `components.json`, kept in step by a test):

```bash
GPOS_TEST_MONGOD=/path/to/mongod pnpm test:single-pc-runtime
```

It provisions a fresh root, checks modes, starts mongod from the generated
config, checks the loopback-only listener (`/proc/net/tcp`), anonymous and
wrong-password refusal, the API user's least privilege, transaction commit
and rollback, repeat runs with the service running and stopped (secrets
unchanged), restart persistence, the compiled API (when `apps/api/dist`
exists) waiting for the DB, health, the #361 command and an ADMIN login,
two concurrent fresh runs and a stale-lock race (portable, in
`layout.test.mjs`), refusal of lost secrets, another installation's identity and a foreign
mongod on the port, and a SIGKILLed fresh run resuming.

### Windows-only proof (not yet done)

`icacls` result and per-identity ACLs, service registration/start order,
boot before login, graceful stop and restart policy, mongod Windows service
shutdown, actual listeners (`Get-NetTCPConnection`), `node --env-file` with
Windows paths, Caddy's TLS state under `tls\`, and recovery after an
interrupted run on NTFS. Record them in
[../proof/ACCEPTANCE-CHECKLIST.md](../proof/ACCEPTANCE-CHECKLIST.md) terms on
an eligible Windows 11 x64 target (#357/#366).
