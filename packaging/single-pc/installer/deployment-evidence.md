# Bundle dependency resolution evidence (#387)

Investigated on 2026-11-16 from develop `e8314454b88cf0715c15f7221d2904fe875ed0df`,
with the repository's pinned pnpm 10.33.0 and Node 22.22.2 on Linux.

## Previous deployment

After `pnpm install --frozen-lockfile` and the contracts build, ran the exact
old builder command:

```bash
pnpm --filter grocery-pos-api deploy --prod --legacy --config.node-linker=hoisted /tmp/gpos-387-legacy
```

It produced 187 production inventory entries. This was actual dependency drift,
not an inference from its warnings. For example:

| Package                  | Workspace lockfile | Legacy deployment |
| ------------------------ | ------------------ | ----------------- |
| @nestjs/common           | 11.2.6             | 11.2.10           |
| @nestjs/core             | 11.2.6             | 11.2.10           |
| @nestjs/platform-express | 11.2.6             | 11.2.10           |
| @nestjs/throttler        | 6.7.0              | 6.7.1             |

Pinned pnpm source (`releasing/plugin-commands-deploy/lib/deploy.js`, distributed
inside `pnpm/dist/pnpm.cjs`) explains the result: the legacy branch sets
`frozenLockfile: false`, `preferFrozenLockfile: false`, and, for the hoisted
linker, `useLockfile: false`. It resolves manifest ranges again. The original
frozen workspace install therefore does not enforce deployment resolutions.
Legacy deployment supplies no installed lockfile for an integrity/peer-snapshot
comparison; matching versions alone would not prove matching integrities.

## Supported deployment

The [pnpm 10 deploy documentation](https://pnpm.io/10.x/cli/deploy) describes
the supported injected-workspace path and its dedicated lockfile. In the pinned
10.33.0 implementation, `deployFromSharedLockfile` calls `createDeployFiles`
and installs with `frozenLockfile: true`. Override effects are already in the
snapshots; workspace references become file references into the built checkout.

Enabling workspace injection changed only `settings.injectWorkspacePackages`
in the source lockfile; it changed no registry versions or integrities. With
`--legacy` removed, the hoisted deployment produced 186 inventory entries:
185 registry packages plus the built `@grocery-pos/contracts` workspace package.
Every registry package's resolution/integrity and every registry dependency
snapshot (including peer bindings) in the installed dedicated
`node_modules/.pnpm/lock.yaml` matched the source lockfile exactly. The workspace
package appropriately has a directory resolution rather than a registry integrity.
The overridden multer remained 2.5.0. Neither ESLint nor node-abort-controller
was shipped by either production deployment.

The committed local-registry regression independently proves that a new release
within a manifest range cannot replace the locked release, including an empty
store, a populated store, an overridden transitive dependency, a peer dependency,
built workspace output, production-only filtering, source-lockfile immutability,
real directories and rejection of a stale source manifest. It uses no public
registry and never reuses the developer's package cache.

These are Linux builder/dependency checks, not Windows installation acceptance.
Windows 11 x64 native execution and the remaining platform checks belong to #366.

## Full bundle repeat

Two full builds on the same machine (first with an empty component cache, then
`--offline` with the populated cache) each produced 13,327 files. Both passed
`readiness.mjs --bundle --manifest-sha256 <recorded hash>` and
`sha256sum -c --quiet SHA256SUMS`. Both API and client dependency inventory JSON
files were byte-identical between builds; the API inventory had 186 entries.
The native-addon validation retained the Windows x64 argon2 prebuild and rejected
other native addon platforms as before.

Recorded bundle manifest SHA-256 values (timestamps/ZIP identity are not the
reproducibility target):

- First build: `421cefae252a541d09877f976c7269770bae1357dc3449ed3245cef1c2c5e8c1`.
- Cached build: `c9294c4f70eee3d65252b1b8afe7b196608cfc35ac5af6e1a5c8916796d00f8d`.
