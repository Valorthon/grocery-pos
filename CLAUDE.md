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
- The only global pipe is `createValidationPipe()`
  (`apps/api/src/common/pipes/validation.pipe.ts`); e2e harnesses use it too.
  Request text is stored as typed (no HTML sanitising, #15); DTOs trim text
  fields with `@Transform`, and password fields have no transform.
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
  pay the cash back out of a shift's drawer (see Shifts), and record
  `reversal`. Revenue excludes reversed sales.
- SPLIT tender stores `tenders`, `amountTendered` and `changeGiven`. A GCash
  `referenceNumber` is 13 digits, unique, and required for non-cash tenders.
- `POST /sales` is idempotent through `idempotencyKey` plus a `requestHash`. A
  replay returns the original receipt. The receipt and drawer figures always come
  from the server response.

**Shifts** (#2)

- Shifts live on the server (`apps/api/src/shift`); the client keeps
  nothing in localStorage. At most one OPEN shift per cashier (unique
  partial index), opened with a positive counted float. Logout leaves it
  open and the same cashier resumes it; nobody else inherits it. ADMIN
  holds every role, so an admin who sells needs a shift too.
- `POST /sales` needs the caller's open shift (409 `SHIFT_NOT_OPEN`),
  writes it with a `status: OPEN` filter in the sale's transaction and
  sets `sale.shift`. Close flips the status in a transaction with the same
  filter. An idempotent replay needs no open shift.
- Blind until submitted: while open, the cashier never sees expected
  cash, sales totals or variance, and cash drops are not checked. Close
  takes bill counts (`CASH_DENOMINATIONS` in contracts); the server
  computes and stores the Z-read (sales by tender, discounts,
  voids/refunds, drawer movements, expected, counted, over/short).
- Expected cash = float + cash in − drops + net cash of the shift's sales
  (cash tender − change, `saleNetCash`) − reversal payouts charged to it.
- Void/refund pays the sale's net cash out of its own shift while open,
  else out of the open shift the ADMIN passes as `payoutShiftId`;
  otherwise it is refused and nothing changes. GCash-only touches no
  drawer. `reversal.payoutShift` records which shift paid.
- An ADMIN can force-close an open shift with a count; the Z-read records
  the admin. Cashiers reopen their last Z-read from the seller dashboard;
  admins see every shift on `/admin/shifts`. CSV and reports are #44.
- A non-admin reads only their own sales in their current open shift
  (none without one; others 404).

**Errors** (#8)

- Error bodies are `{statusCode, error, message, timestamp, path, details,
requestId}`. A 5xx never carries details or internals.
- `runInTransaction` classifies DB errors: a duplicate key is 400
  `DB_DUPLICATE_KEY` with field names only, a validation failure is 400
  `DB_VALIDATION_ERROR`, and AppErrors pass through. An HttpException keeps its
  status, with a matching code.
- `X-Request-Id` is on every response and exposed via CORS. A 5xx is logged
  at error level with its stack; a 4xx is one warn line. The access log
  (`TimingMiddleware`) prints the path without the query string, plus the id.

**Text** (#15)

- There's no sanitising pipe. Text is stored as typed, and Vue escapes it on
  render. Every body string field needs a trim `@Transform` (the walker in
  `validation.pipe.spec.ts` enforces it); password fields get none.
- Legacy entity-encoded data is fixed by the one-off
  `pnpm migrate:decode-entities` (README deploy notes).

**Barcodes and search** (#14)

- Barcodes are EAN-13, UPC-A or EAN-8 with a valid check digit, stored as
  scanned; the rules are in contracts `barcode.ts`. Typed codes in the
  generated 200… range are refused.
- A restock line needs exactly one of `newProduct` or `product`.
- Name search is "contains" and barcode search is prefix, via
  `common/utils/regex.ts` and `product/product-search.ts`.
- `Inventory.updatedBy` means the last writer.

**Reporting** (#16)

- Every paginated query caps `limit` at `PAGINATION.LIMIT_MAX` (100). Every
  body list has an `@ArrayMaxSize` from `BATCH_LIMITS` (200 lines per sale,
  restock, adjustment or product batch; 50 users). `limits.spec.ts` walks the
  controllers and enforces both.
- User-facing totals use `countDocuments`, never `estimatedDocumentCount`.
- The dashboard's low stock is `1 ≤ stock ≤ LOW_STOCK_THRESHOLD` (10, in
  contracts, until #40), and out of stock is `stock ≤ 0`. Neither counts
  orphan inventory rows. Every dashboard role sees both tiles.
- `GET /sales` takes `cashier` and `dateFrom`/`dateTo`. For ADMIN they filter
  everything. For anyone else they only narrow the own-open-shift scope, and
  naming another cashier returns nothing. Sales are indexed on `{createdAt}`,
  `{cashier, createdAt}` and `{shift, createdAt}`.
- `startOfDayInZone` returns the first of two repeated midnights on a
  fall-back day (Amman 2021-10-29), searching back up to 3h.

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

**Sessions** (#21)

- A session lasts `REFRESH_EXPIRY_S` (7 days in `.env.example`) from login,
  fixed; refresh-token rotation keeps that expiry. The refresh and marker cookies expire with the session, and
  the access token is capped at the session end.
- The axios refresh accepts any 2xx, has a timeout, and marks queued
  requests `_retry`. Only a 401 from refresh logs out; a timeout or 5xx
  doesn't.
- Login errors are chosen by status only (`login-error.ts`): 400/401 the
  generic message, 429 "try again in…", network/5xx "can't reach the
  server". The login page has no Remember me, Privacy or Terms; a forgotten
  password is "ask an admin to reset it".

**Client payloads and errors** (#33, #18)

- The `utils/payloads.ts` mappers send exactly the DTO fields.
- `utils/api-error.ts` (`apiErrorMessages`/`apiErrorText`) is the one way to
  read an API error.
- Server failures of user actions are toasts; field validation is inline;
  list and dashboard load failures are an inline error with Retry via
  `useListFetch` (BaseTable `error`/`@retry`), and only the latest load
  writes.
- Error toasts stay until dismissed (`role=alert`); success/info close by
  themselves. The stack is capped at 5 and cleared when the session changes.
- Save dialogs (including the Users dialogs) stay open until the save
  resolves.

**Forms** (#17)

- Field rules in `utils/rules.ts` mirror the API DTOs exactly, neither
  stricter nor looser. Forms validate on submit and show errors inline.
- Money is typed as text and parsed by `parsePesos`.
- `BaseInput` has `inheritAttrs: false`: attrs go on the `<input>`, class and
  style on the wrapper.
- The product combobox binds a snapshot taken at pick time; toggling "new
  product" clears it. Product search goes through `useProductMatches`
  (debounced, out-of-order answers dropped).

**Draft screens** (#19)

- Draft rows are keyed by a page-local `draftId` (a counter, never sent),
  via `useDraftList`.
- `ConfirmDialog` + `useConfirm()` confirm Clear and leaving with drafts
  (`useUnsavedDraftsGuard`). `beforeunload` is registered only while drafts
  exist.
- Sign out (`authStore.requestLogout`) navigates to Login first, so a draft
  page asks "Log out and discard?"; "Stay" keeps the drafts and the
  session. A forced logout (the session already ended) never asks.
- While a save is in flight, navigation is held with an info toast, no
  prompt. Products Save All submits once; empty restock/adjustment lists
  are refused.
- In `BaseModal`, only the topmost modal answers Escape, and the scroll
  lock is ref-counted.

**List views** (#20)

- Paged lists use `useListPaging`: a page change loads once, a page-size
  change goes back to page 1, and `search()` (filter change, Enter, Search
  button, Clear Filters) goes to page 1 with a single load.
- Text searches run on Enter, a Search button or clearing the box (×).
  Select and date filters apply on change. `BaseSelect`'s opt-in
  `allLabel` adds an "All" option that maps to `null`.
- Requests read the last applied filters (`useAppliedFilters`, or the
  `applied` snapshot on restock/adjustment history), so paging, a page-size
  change and Retry never send typed-but-unsearched text.
- A reversed date range (`dateFrom` after `dateTo`) is a 400 from the
  restock, adjustment and sales GetAll DTOs (`@IsNotBefore('dateFrom')`).
  The client shows `dateRangeError` on the To field and keeps the last
  valid range; a user-select change still applies with it.
- BaseTable hides its pager while `error` is set.
- Sale details clear before loading, and only the latest click's answer is
  shown. The user editor edits a copy of the row's roles, so Cancel changes
  nothing. Create validates name (trimmed), password and roles like
  `CreateFields`; a field's error clears when it is edited.
- Dashboard recent activity is sorted on raw timestamps, then cut to 7.

**Scope**

- Receipts are shown on screen only, with no printing. BIR compliance (VAT,
  official receipts, SC/PWD) is deferred to #48.
- Editing and archiving products is #38, not part of the list views.
- Open decisions are in **#61**: USER_MANAGER self-edits, and a fail-closed
  `RoleGuard`.

## Status

Phases 1–5 of #31 are complete. Phase 5 (#21, #33, #17, #18, #19, #20)
covered sessions and client correctness: payloads, forms, errors, draft
screens and list views. Next is Phase 6, the register, starting with #22.
