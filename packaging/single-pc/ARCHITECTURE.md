# Single-PC architecture (#357)

Status: engineering architecture selected; **Windows 11 proof pending**. This
document does not certify a release or close #357. The owner authorized full epic
implementation after its original planning-only creation. No customer installation,
deployment or data migration is authorized by that request.

## Product decisions

Recorded on [#357](https://github.com/Valorthon/grocery-pos/issues/357), with later
owner comments taking precedence:

- First release: Windows 11 on Intel/AMD x64, Google Chrome. Windows 10 and ARM
  are outside first-release support. The expected 4 GB DDR3 computer is a
  qualification target; support depends on measurement on eligible hardware.
- Vendor installs and manually updates during the agreed maintenance period.
  Afterwards the owner has documented daily operation and guided replacement
  reinstall/restore. No guaranteed recovery time or supplied spare PC.
- Daily automatic local backups, 30-day retention; external-drive exports without
  a password and weekly reminders. The store owner holds credentials and keys.
- Updates require closed shifts and synchronized pending receipts. The agreed
  maintenance window is 30 minutes; populated-machine testing must verify it.
- Initial account is ADMIN only with a unique temporary password per store and
  mandatory first-login change. No shared default, demo seed, implicit SELLER
  role or bypass of later step-up/PIN rules. #361 implements this flow.
- No desktop wrapper, Docker Desktop, activation, automatic application updates,
  machine locking, LAN access, printing or synchronization is included.

## Runtime decision

Use native background services: authenticated MongoDB 7 single-node replica set,
compiled Node API/contracts, Caddy serving the compiled Vue client and proxying
API paths. Use stable WinSW NET461 for the Node service; Caddy and MongoDB use
their documented native service interfaces. The installer must preflight the
required installed .NET Framework and fail clearly if unavailable. Daily browser
operation is non-admin. No developer tooling or store-time dependency downloads.

Native services avoid a guest OS/container runtime on the 4 GB test target.
Docker Desktop's published Windows prerequisite is 8 GB RAM plus virtualization;
it cannot meet this proposed minimum. Native services still require resource
measurement and service lifecycle testing. A desktop wrapper would add another
browser distribution and profile lifecycle without a required product feature.
[Docker prerequisites](https://docs.docker.com/desktop/setup/install/windows-install/).

Exact proof/runtime pins, upstream locations and archive checksums are in
[components.json](components.json): Node 22.23.5, MongoDB 7.0.48, argon2 0.44.0,
Caddy 2.11.9 and WinSW 2.12.0 NET461. Node/Mongo hashes were read from official
release metadata on 2026-11-14. The proof verifies them before extraction and
compares its executing Node binary with the verified archive. Caddy/WinSW
acquisition, archive hashes and redistribution materials remain #362 work; these
pins do not mean those executables have passed Windows execution tests.
[Node checksums](https://nodejs.org/dist/v22.23.5/SHASUMS256.txt),
[Mongo release metadata](https://downloads.mongodb.org/current.json),
[Caddy release](https://github.com/caddyserver/caddy/releases/tag/v2.11.9),
[WinSW release](https://github.com/winsw/winsw/releases/tag/v2.12.0).

## Platform and hardware qualification

Qualify a still-serviced Windows 11 Home/Pro x64 build, initially 25H2 or later,
recording edition, full build and Chrome version in release evidence. Do not
equate the proof's OS identity check with lifecycle qualification. Current
Home/Pro lifecycle documentation lists 24H2 support ended October 13, 2026;
other editions have their own lifecycles. S mode is not an installation target.
[Windows lifecycle](https://learn.microsoft.com/en-us/lifecycle/products/windows-11-home-and-pro).

Windows 11 requires an eligible CPU, two cores, 4 GB RAM, 64 GB storage,
UEFI/Secure Boot capability and TPM 2.0. These are OS eligibility requirements,
not POS performance or free-space promises. Check the actual CPU model against
Microsoft's selected-release requirements and Mongo's AVX/microarchitecture
requirements; DDR3 alone identifies neither. SSD is preferred for qualification.
[Windows requirements](https://learn.microsoft.com/en-us/windows/whats-new/windows-11-requirements),
[Intel models](https://learn.microsoft.com/en-us/windows-hardware/design/minimum/supported/windows-11-supported-intel-processors),
[AMD models](https://learn.microsoft.com/en-us/windows-hardware/design/minimum/supported/windows-11-supported-amd-processors).

MongoDB 7 supports Windows 11 x86_64 and excludes WSL. Its default WiredTiger
cache is 1.5 GB on a 4 GB machine; qualify an explicit smaller cache with the
whole workload. The proof uses 0.25 GB only to bound its synthetic experiment,
not as an approved production cache or total mongod memory cap. Measure Windows,
Chrome, API, proxy, DB, password hashing, backup and migration simultaneously,
including paging, disk growth, startup and representative checkout/report times.
No minimum RAM/storage or workload performance result is claimed yet.
[Mongo platform support](https://www.mongodb.com/docs/v7.0/tutorial/install-mongodb-on-windows/),
[Mongo production and cache guidance](https://www.mongodb.com/docs/v7.0/administration/production-notes/).

## Local access interface (#358)

Stable browser origin: `https://localhost:1443`. Bind the proxy explicitly to
`127.0.0.1` and `::1`; API to `127.0.0.1:13000`; Mongo to loopback port 27018.
Refuse conflicts instead of silently changing the origin/ports and losing access
to browser-held records. Proxy `/v1/*`, serve public assets with the existing
cache/security policy and same-origin CSP reports. Disable Caddy's admin listener
and automatic public-CA/HTTP listeners. No exposed LAN interface or local admin API.

Use Caddy's per-installation internal CA with offline certificate renewal. Installer
explicitly installs trust for the supported Windows/Chrome context and verifies
no browser warning. Persistent protected TLS state survives repair/update.
Document root expiry/recovery and replacement-machine trust separately; application
updates never require changing browser origin. Root/private-key access is limited
to the service identity and owner/admin, and is never an export of a common CA.
[Caddy local HTTPS](https://caddyserver.com/docs/automatic-https#local-https).

Add an explicit single-PC production topology configuration, not a new development
mode. Local auth cookies are Secure, host-only and SameSite=Lax with matching
deletion/marker behavior. The fixed local bundle API URL is sufficient; no runtime
URL configurator is needed. API proxy trust, strict Origin/Host validation and
loopback binds must prevent spoofed proxy or unapproved browser-origin use.
Cloud/staging domains, Secure cookies and origin allowlists retain their defaults.
Business services, permissions, money, approvals and audit semantics remain shared.

Implemented (#358): API `APP_ENV=single-pc` (`HOST` loopback, default
`127.0.0.1`; no proxy trust, so `req.ip` is the socket peer; Host/Origin
must match `FRONTEND_URL`, checked before any body is parsed, except GET/HEAD
`/v1/health*`; Secure host-only Lax cookies), client `VITE_APP_ENV=single-pc` with the
relative `VITE_API_URL=/v1`, and [caddy/Caddyfile](caddy/Caddyfile). The
API binds IPv4 loopback (`127.0.0.1:13000`) only, and Caddy proxies to
`127.0.0.1`; Caddy itself listens on both `127.0.0.1` and `::1`. Root trust installation,
TLS state location and service wiring remain #360/#362.

## Persistent installation and lifecycle interfaces (#360–#365)

- Replaceable binaries: `%ProgramFiles%\Valorthon\GroceryPOS\releases\<version>`.
- Persistent state: `%ProgramData%\Valorthon\GroceryPOS` with separate `config`,
  `secrets`, `database`, `tls`, `logs`, `backups` and `state` directories.
- Separate least-privilege service identities; explicit ACLs. DB owns data/logs,
  API reads protected application/DB credentials, proxy reads public assets and
  owns TLS state. Generate unique secrets and DB/keyfile material on installation;
  no credentials in source, package, command arguments, shell history or logs.
- DB provisioning is bounded/resumable and refuses foreign/incompatible state.
  Wait for authenticated writable primary and required indexes before accepting
  application traffic. Distinct bootstrap command creates only the first ADMIN.
- Services start in dependency order before interactive login, gracefully stop,
  and use bounded restart policies. Diagnostic readiness is distinct from a
  listening process. Installer preflights disk/ports/OS and preserves data,
  configuration, secrets, TLS and browser profile on repair/reinstall/uninstall.
- Backups use a supported consistent DB procedure and a versioned manifest,
  include recoverable signing/configuration evidence, verify completed output,
  retain only verified backups and expose last verified success/failure.
  External archives are owner-approved plaintext: possession exposes their
  contents, including any recovery secrets. Document physical custody. Machine-
  bound protection alone cannot be the replacement-installation recovery method.
- Browser localStorage/IndexedDB are separate: never clear them during maintenance,
  never assume DB backup captures pending cash, and never blindly replay cash
  after restore. #363 defines the guided synchronization/reconciliation limits.
- Upgrade verifies a compatible bundle and backup, quiesces writers, journals
  migration/switch stages, and changes API/client together. It refuses incompatible
  app/data versions. Binary rollback is not schema recovery. Preserve a recovery
  copy; no restore over later sales without explicit operator action.
- Bound logs, redact credentials and expose actionable diagnostics without a LAN
  endpoint, automatic upload or telemetry. Customer UI details remain in the
  owning issue and owner decisions.

Release manifest interface: schema/version, Git commit, platform/architecture,
exact component pins/checksums/notices, client/API/contracts compatibility,
data/migration version, backup compatibility, packaged command entry points and
installation identity. The runtime image does not currently package the top-level
ts-node migration launchers; #364 supplies production commands and prerequisites,
never automatically runs legacy backfills on a fresh/live installation.

## Distribution obligations

Retain the exact Node distribution's complete license/third-party notices and
argon2/upstream Argon2 notices. Caddy uses Apache-2.0 and WinSW MIT; collect exact
shipped notices and dependencies when acquiring them, including .NET requirements.
Mongo Community is SSPL-1.0: document a concrete binary/source/notice delivery
method meeting its terms, including physical-media obligations where applicable.
The SSPL distinguishes independent aggregates; do not infer that this independent
POS must change license. No completed legal/commercial distribution clearance is
claimed by pnpm's workspace scan or this ADR. #362 must include the corresponding
source/offer and notices for its chosen channel before distributing a bundle.
[Node license](https://github.com/nodejs/node/blob/v22.x/LICENSE),
[argon2 source](https://github.com/ranisalt/node-argon2/tree/v0.44.0),
[Caddy license](https://github.com/caddyserver/caddy/blob/v2.11.9/LICENSE),
[WinSW license](https://github.com/winsw/winsw/blob/v2.12.0/LICENSE.txt),
[Mongo SSPL](https://www.mongodb.com/legal/licensing/server-side-public-license).

## Proof and acceptance status

[proof/README.md](proof/README.md) describes the #357 compiled-runtime proof.
It refuses Linux, Windows Server, Windows 10 and ARM before creating state; uses
verified archives, a new private throwaway DB directory and generated credentials;
proves default native argon2, authenticated primary, transaction commit/rollback,
anonymous refusal and login/profile through the compiled API. It does **not**
run `dist/main.js`'s current all-interface listener, install services, implement
#358, or count as browser/package acceptance.

No actual Windows 11 execution has been performed from this Fedora session.
The harness and mocked policy checks are preparation, not positive platform proof.
The owner authorized merging #376 (squash b673486) before target proof as a
specific exception. #357 and its epic checkbox stay open until actual Windows 11
x64 proof and hardware qualification are recorded, using the operator runbook
and evidence template in
[proof/ACCEPTANCE-CHECKLIST.md](proof/ACCEPTANCE-CHECKLIST.md).

Obtain a licensed clean Windows 11 x64 PC/VM on the approved build, plus replacement
restore target and another LAN peer. For a VM use 4 GB, at least two vCPUs and
Windows-required security settings; the exact hardware test must also cover the
expected low-end PC. No Windows license/image/VM access is currently available
to this session. Hosted x64 Windows CI uses Server images, so it can supplement
native smoke checks but cannot substitute for Windows 11 proof; its Windows 11
hosted ARM option is not this target. No external provisioning was performed.
[GitHub runner specifications](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

Record real artifact/OS/Chrome versions, hardware, full workload and limitations.
#366 still requires clean offline install, non-admin use, boot before login, crash,
no-internet/full-local-API operations, API outage/recovery/lost answers, authenticated
transactions, LAN refusal, replacement restore, populated/interrupted upgrade,
stale assets, pending receipts and repair/uninstall/reinstall preservation.
