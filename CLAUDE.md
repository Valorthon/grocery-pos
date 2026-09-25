# CLAUDE.md

Guidance for Claude Code sessions (local or cloud) working in this repo. Read
`README.md` for setup and issue **#31** for the phase plan before starting work.

## Repo

pnpm 10 workspace, Node 22:

- `apps/api`: NestJS 11 + Mongoose 8 (MongoDB, transactions need a replica set)
- `apps/client`: Vue 3 + Vite + Tailwind 4
- `packages/contracts`: the single source of truth for roles, limits, enums,
  error codes and shared money math. Change shared things here, not in one app.

**Build contracts first**, or the API and client can't resolve `@grocery-pos/contracts`:

```bash
pnpm --filter @grocery-pos/contracts build
```

## Gates (all must pass from the repo root before a PR is merged)

```bash
pnpm -r lint
pnpm -r typecheck
pnpm -r test
VITE_NODE_ENV=prod VITE_API_URL=https://api.ci-test.com VITE_DOMAIN=ci-test.com VITE_API_TIMEOUT=5000 pnpm -r build
```

GitHub CI is known red for unrelated reasons (#28). Merges are gated on the four
local gates, not on CI.

## Workflow for issues under #31

Phases in #31 run in order. Within a phase, each issue gets its own cycle:

1. **Implement.** A fresh subagent creates `fix/<N>-<slug>` from `origin/develop`
   and reads `gh issue view <N> --comments`. Where an issue's **"Update"** block
   conflicts with the original report, the update wins, and so do later comments
   that route follow-ups into it. The subagent stays in scope, adds regression
   tests next to the existing specs, passes the gates, and opens a PR against
   `develop` with `Closes #N` and a Verification section.
2. **Review.** A separate, read-only reviewer subagent works in its own detached
   worktree and ranks findings as blocker, should-fix or nit, each with
   file:line and a concrete failure scenario.
3. **Fix.** Confirmed findings go back to the implementer, and the gates run again.
4. **Merge.** `gh pr merge <PR> --squash --delete-branch`. Confirm the issue closed,
   then tick it in #31's body (`- [ ] #N —` → `- [x] #N —`).
5. **Record leftovers.** Anything deferred goes as a comment on the issue it
   belongs to. Nothing may live only in a conversation.

Rules:

- Issues may run **in pairs** only when they don't touch the same files. The
  second one runs with `isolation: worktree`. A new pair starts only after both
  PRs of the current pair are merged. The PR that merges second rebases onto
  `develop` and re-runs the gates.
- Merges need no confirmation. The product owner verifies at the end of a phase.
- Stop at the end of the requested phase. Don't start the next one unasked.
- Product decisions (who may do what, what the UI shows) go to the user. Don't guess.
- Commits use conventional format (`fix(sales): …`). **No attribution or
  Co-Authored-By lines** in commits or PR bodies.
- Never commit directly to `main`, `master` or `develop`.

## Testing conventions

- API: jest `*.spec.ts` next to the code, with mocked Mongoose models. E2E-style
  access tests run a real Nest app (real global guards, filter and
  `ValidationPipe`) over HTTP with `fetch`. See
  `apps/api/src/common/testing/access-harness.ts` and
  `apps/api/src/auth/auth.e2e.spec.ts`. Test-only helpers live under
  `**/testing/**`, which the build excludes.
- `sanitize-html` is ESM-only and can't be loaded by jest. Tests stand in for
  `SanitationPipe` instead of loading it.
- Client: vitest. Components are mounted with plain `createApp` in jsdom; there
  is no `@vue/test-utils`.
- Behaviour that needs a real replica set (unique partial indexes, transactions
  under concurrency, TTL indexes) can't be proven with mocks. Locally, reviewers
  used a throwaway podman `mongo:7 --replSet rs0` container. Cloud sessions have
  no Docker or podman: say so in the PR, and flag which checks the user should
  run locally (or see #30 for an in-memory replica set).

## Decisions already made (don't re-litigate)

**Money and stock**

- Money is **integer centavos** everywhere: DB, DTOs, contracts limits and client
  state. Pesos exist only at the input and display boundary, through
  `apps/client/src/utils/currency.ts` (`pesosToCentavos`, `formatCurrency`).
  `NUMERIC_LIMITS.AMOUNT_MAX` is ₱10,000,000.
- Stock writes use a `$gte` guard in the filter plus a `matchedCount` check. Lines
  are netted per product, and stock is read before the write
  (`inventory.service.ts`).
- Day boundaries use `STORE_TIMEZONE` (default `Asia/Manila`) via
  `apps/api/src/common/utils/timezone.ts`. Date filters are `dateFrom`/`dateTo`
  in `YYYY-MM-DD` format.

**Sales**

- The discount is computed on the server by `discountAmount` in
  `packages/contracts/src/discount.ts` and needs a reason. `Sales.discount`
  records `approvedBy`. Any SELLER may apply one until the manager PIN (#34).
- Void and refund cover the whole sale only, are ADMIN-only, put the stock back,
  and record `reversal`. Revenue excludes reversed sales.
- SPLIT tender stores `tenders`, `amountTendered` and `changeGiven`. A GCash
  `referenceNumber` is 13 digits, unique, and required for non-cash tenders.
- `POST /sales` is idempotent through `idempotencyKey` plus a `requestHash`. A
  replay returns the original receipt. The receipt and drawer figures always come
  from the server response.

**Access**

- An expired or invalid JWT gets 401, and every `AUTH_*` code maps to 401. Routes
  are `@Public()` (login, refresh, logout, health) or declare `@Roles(...)`.
  `route-roles.spec.ts` forbids an empty `@Roles()`.
- USER_MANAGER may manage users whose roles are all SELLER, ADJUSTER or RESTOCKER
  (`MANAGEABLE_ROLES`). Only ADMIN may touch ADMIN or USER_MANAGER accounts or
  reset other users' passwords. Nobody may change their own roles. The last
  active ADMIN can't be removed.
- Dashboard money is ADMIN-only and stripped on the server. A cashier sees only
  their own sales. Price changes are ADMIN-only.
- Deactivating a user, changing their roles, or resetting or changing a password
  revokes that user's sessions. Login is rate-limited, and all login failures
  return one generic 401. Passwords are at least 8 characters.

**Scope**

- Receipts are shown on screen only, with no printing. BIR compliance (VAT,
  official receipts, SC/PWD) is deferred to #48.
- Open decisions are in **#61**: USER_MANAGER self-edits, and a fail-closed
  `RoleGuard`.

## Status

Phases 1 and 2 of #31 are complete. Next is **Phase 3: #2** (server-side shifts
and cash accountability). Cash refunds adjusting the drawer were deferred to #2;
see its comments.
