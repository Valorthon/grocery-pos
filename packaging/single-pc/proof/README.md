# Windows 11 compiled-runtime architecture proof

This is the bounded #357 platform experiment, not an installer or customer
bootstrap. It only creates a uniquely named temporary directory and database
with generated throwaway credentials. It accepts no existing DB URL or credentials.
Do not run it against a customer installation. No platform proof has yet passed.

## Prepare on the Windows build machine

Use an eligible Windows 11 Intel/AMD x64 PC and the exact Node archive in
`../components.json`. Acquire both archives through the listed official URLs
before taking the target offline. Preserve upstream provenance/signature and
license materials with the test record; SHA-256 alone is integrity, not an
independent signature verification. The harness refuses a checksum mismatch.

Build the contracts first and API from the intended full Git commit. Prepare an
isolated production dependency tree using pnpm's deploy command (build-machine
tooling only):

```powershell
pnpm --filter @grocery-pos/contracts build
pnpm --filter grocery-pos-api build
pnpm --filter grocery-pos-api deploy --legacy --prod C:\gpos-proof-api
# API's gitignore excludes dist from package copying; add the compiled output.
Copy-Item -Recurse apps\api\dist C:\gpos-proof-api\dist
```

In **that new throwaway artifact directory only**, remove the copied `src`,
`test` and top-level development scripts/configuration. Retain `package.json`,
`dist` and production `node_modules`, including the built contracts and Windows
native argon2 module. The harness refuses a `src` directory and never loads
ts-node. Do not copy Linux node_modules; do not run npm/pnpm on the test target.
This staging exercise is not the release packager owned by #362.

Copy the small `packaging/single-pc` proof directory, the prepared API tree and
the two verified archives onto the clean target. No service, global runtime,
certificate, firewall or customer state is installed by this tool.

## Run on the actual target

Extract the pinned Node zip into a new test-tools directory. Run its node.exe:

```powershell
C:\gpos-tools\node-v22.23.5-win-x64\node.exe .\proof\run.mjs `
  --api C:\gpos-proof-api `
  --node-archive C:\gpos-tools\node-v22.23.5-win-x64.zip `
  --mongo-archive C:\gpos-tools\mongodb-windows-x86_64-7.0.48.zip `
  --output C:\gpos-evidence\architecture-proof.json `
  --commit FULL_40_CHARACTER_GIT_COMMIT
```

The output parent must exist and the output file must not exist. A failed or
ineligible run never writes passing evidence or overwrites an earlier report.
The tool obtains OS/CPU identity from CIM; its OS guard is not a claim that
every Windows 11 build/CPU is still serviced or eligible. Record that qualification
separately. PowerShell, CIM, Get-NetTCPConnection and icacls must be available;
missing capabilities fail the proof. Execution uses current-user-only temp ACLs.

The test verifies its Node executable matches the official archive, extracts
only a verified Mongo archive, starts its own loopback DB, and verifies the
listening socket belongs to that child before using Mongo's localhost exception.
It then creates root and scoped app credentials in memory, authenticates a writable
replica-set primary, refuses an anonymous collection read, commits one transaction
and rolls another back, and checks correct/wrong passwords with default native
argon2. A synthetic ADMIN exists only in the newly created test database.

The compiled AppModule is booted with production validation/secrets, ordinary
global guards/filter, cookie parser, validation/body parsers and versioned routes.
Its test listener is explicitly loopback with an ephemeral port. HTTP login and
authenticated profile verify native runtime integration; manually transferring
cookies in Node is **not** browser/TLS/cookie-policy acceptance. Existing main.ts
bind/proxy behavior is unchanged and belongs to #358. The tool closes API/DB and
removes its private directory before writing redacted successful evidence.

Each external process/connection/request/readiness wait has a timeout. A failed
run reports a fixed message, never raw driver/OS errors, request bodies, DB URLs,
passwords or child logs. Do not publish the private temporary directory. If the
proof process itself is killed, its child/temp state may need manual cleanup:
identify only the mongod process whose config path lies inside the exact new
`gpos_archproof_*` directory; stop that test child and remove that directory.
Never stop/delete another Mongo installation. No interrupted-proof recovery is
claimed as customer lifecycle evidence.

## Read the evidence narrowly

Success identifies the declared source commit, compiled API entry/module hashes,
verified archive versions/hashes, actual target identity, assertions, native
password duration and end-of-run host/process memory observations. The source
commit is supplied by the build operator, not cryptographically attested by this
tool. Preserve the matching immutable build inputs alongside it.

No Chrome, Caddy, WinSW, TLS, service installation, reboot, 4 GB workload,
backup/restore or upgrade was exercised. Process memory and free RAM samples are
not a minimum-hardware measurement. #357 still needs actual target execution and
review; #366 owns complete installed release acceptance.

Run portable refusal/checksum/deadline regression checks with
`pnpm test:single-pc-proof`; CI runs those checks independently of a Windows claim.
