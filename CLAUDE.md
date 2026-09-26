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
pnpm --filter @grocery-pos/contracts build
pnpm format:check
pnpm -r lint
pnpm -r typecheck
pnpm -r test
VITE_APP_ENV=prod VITE_API_URL=https://api.ci-test.com VITE_DOMAIN=ci-test.com VITE_API_TIMEOUT=5000 pnpm -r build
```

CI runs the same steps (plus audit, depcheck and `pnpm licenses:check`) and
passes on a clean checkout since #28, so a red run is a real failure. Lint is `--max-warnings 0`, and
`test` enforces coverage thresholds (jest `coverageThreshold` in
`apps/api/package.json`, vitest `thresholds` in the client and contracts
`vitest.config.ts`). Raise a threshold when coverage rises; never lower it.

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
  under concurrency, rollback, TTL indexes) can't be proven with mocks. It goes
  in the DB suite, `apps/api/test/db/*.db-spec.ts` (#30): the real `AppModule`
  over HTTP (`test/db/db-app.ts`), one throwaway `gpos_dbtest_*` database per
  file. Run it with `pnpm --filter grocery-pos-api test:db`, with
  `MONGO_URI_TEST` pointing at the docker compose MongoDB (README). It is
  not part of `pnpm -r test`; CI's `db` job runs it on every PR and push. A
  cloud session may be able to start `dockerd` and run
  `mirror.gcr.io/library/mongo:7` (Docker Hub rate-limits) with the repo's
  `mongo-init.sh`; if it can't, say so in the PR and rely on the `db` job.

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
  alone can't sell or run a shift: an admin account also needs SELLER
  (#84), and then needs a shift of its own like any cashier.
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

**Wire contracts** (#27)

- Every response body has a type in contracts: `src/wire/` (sales,
  catalog/stock, users/auth, dashboard, shift wrappers), the shift views in
  `shift.ts`, `AppErrorResponse` (`error: ErrorCode`) and `Paginated<T>`.
  Ids and dates are strings; money is centavos; the ADMIN-only dashboard
  fields are optional.
- Each has a `*_SHAPE` (`WireShape<T>`: every key, required/optional,
  compiler-checked). Controllers declare the wire type as their return
  type via `asJson` (`common/wire.ts`); services type `.lean()`/populate
  reads with `*Doc` types.
- Drift: `test/db/wire.db-spec.ts` checks real responses, every nested
  object and every array element, against the shapes (`wireShapeDiff`,
  `__v` ignored), plus value kinds by key name (`_id` an id string,
  timestamps ISO, money integers) and populated-vs-id refs per route.
  Unit specs check the receipt, Z-read, dashboard and error body. A new or
  renamed response field goes in the contract type and its shape.
- No response carries a sale's `idempotencyKey` or `requestHash`
  (`INTERNAL_SALE_FIELDS`, projected out of `GET /sales`, the dashboard's
  `recentSales` and the void/refund answer); the server keeps them for
  replays.
- Client: `api.get<T>` with contract types, no `any`, no eslint-disable.
  `no-explicit-any` and the `no-unsafe-*`/`no-redundant-type-constituents`
  rules are errors. Shared types live in `.ts` files, never exported from
  `.vue`. `BaseTable` is generic over its rows.
- Client errors: `apiErrorCode`/`apiErrorBody` in `utils/api-error.ts`
  return the typed `ErrorCode`; branch on it when the reason matters.
  Session handling still keys on the 401 status (every `AUTH_*` is a 401).
- `GET /users` validates with the user module's `GetUsersDto` (renamed
  from its `GetAllDto` in #27, same rules: name ≤ `USERNAME`, no `EAN`);
  `user.e2e.spec.ts` pins it.
- Contracts' relative imports end in `.js`; the build fails otherwise, so
  plain Node can load the ESM build.

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
- A USER_MANAGER may rename themselves but not deactivate themselves (403
  `USER_SELF_DEACTIVATE`); the Users editor disables their own Active box.
  An ADMIN may deactivate themselves unless they are the last active ADMIN
  (`USER_LAST_ADMIN`) (#61).
- `RoleGuard` fails closed: a non-`@Public()` route whose `@Roles` is
  missing or empty is 403 for everyone. `route-roles.spec.ts` finds the
  controllers by walking `AppModule`'s module metadata
  (`common/testing/app-routes.ts`, inherited handlers included) and fails
  on such a route (#61).
- ADMIN passes every `@Roles(...)` check except on `@RequireOwnRole(...)`
  routes, where only the listed roles themselves count (#84): `POST /sales`
  and the cashier's own shift routes (open, current, drawer, close,
  last-closed) need SELLER itself, matching the client's `sellerOnly`.
  Void/refund, force-close, the admin sales/shift views and the dashboard
  stay ADMIN-only. Contracts `PERMISSIONS` marks those rows `ownRoleOnly`,
  and `role-permissions.spec.ts` checks it against the metadata.
- Dashboard money is ADMIN-only and stripped on the server. A cashier sees only
  their own sales. Price changes are ADMIN-only.
- Only RESTOCKER (and ADMIN) add or edit products (`POST /products/bulk`,
  `GET /products/ensureValid`, `PATCH /products`); ADJUSTER keeps stock
  adjustments and product lookup (#83).
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
- The UI says "Log in" and "Log out", never "Sign in/out"
  (`layout-drift.spec.ts`). The login fields have visible "Username" and
  "Password" labels tied by `for`/`id`; the placeholders stay as hints
  (#85).

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
- A restock unit cost may be ₱0 (`NUMERIC_LIMITS.UNIT_COST_MIN`, DTO and
  schemas alike), never negative; saving asks "Record at ₱0 cost?" naming
  the ₱0 lines, and "Go back" keeps the drafts (#85).
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
- Log out (`authStore.requestLogout`) navigates to Login first, so a draft
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

**Register (Phase 6)** (#22–#26)

- Keys (`useRegisterShortcuts`): F2 scan box, F4 selected line's quantity,
  F8 discount, F9 Tender & Charge. F5 is never bound. Keys are off while a
  modal is open (except the tender sheet).
- Delete (#85) removes the focused ticket line, or, from the scan box
  while it is empty, the highlighted line (the one just scanned or
  selected; else the last line). With text in the box (or mid-IME
  composition) Delete edits the text. Both have the 5s Undo. Only the
  first press counts (a held key's repeats are ignored). Never while the
  tender sheet or a modal is on top, or from the discount, the Qty picker
  or a quantity field.
- `BaseModal` is a labelled `role=dialog`; `modal-stack.ts` owns Escape
  (topmost only), the focus trap, `inert` background, scroll lock and focus
  return. The scan box takes the focus back after clicks and modals.
- While a receipt shows, a stray Enter does nothing and a scan starts the
  next sale with that item.
- Void Ticket asks first, with lines and units ("Void this ticket (2
  lines, 5 items)?", singular for 1). A removed line has a 5s Undo. Quantities are
  editable. The Qty multiplier (or `12*`) applies to the next scan only and
  shows a badge.
- Basket, discount and checkout attempt (`idempotencyKey`) are kept per
  cashier in localStorage `grocery_pos_cart_v1:<userId>`, so a reload
  retries the same key and can't double-charge. Cleared on sale, void and
  logout; synced across tabs.
- Quick cash is Exact plus up to 4 next round amounts (₱20/50/100/500/1000
  steps). SPLIT: GCash pays what the cash doesn't; cash covering the total
  is sent as CASH (`splitTender`).
- Receipt: the sale's server time in the store timezone, sale number (last 8
  of the id) plus the full id, a Change line for any cash tender (₱0 too),
  one "Discount" label. No print buttons or fake store details (store
  settings are #47).
- The Roles page is built from contracts `PERMISSIONS`; `role-permissions`
  (API) and `role-pages` (client) specs keep it in step.
- Denominations are unchanged. Shift In refuses a ₱0/empty float with an
  inline reason. `BillCountInput` counts on input, flags bad entries inline
  and reports them via `v-model:invalid`.
- Toasts (#85): top-right in the admin layout; bottom-center in the seller
  layout (`uiStore.toastPlacement`, set by `SellerLayout`). On the
  register (`uiStore.registerToast`, set by `Sell.vue`;
  `components/toast-placement.ts`) they sit at the bottom, centred on the
  measured ticket column (sidebar included), above the sticky Tender
  footer below `lg`, and above the Undo bar while it shows; while the
  tender sheet is open they move to the top (over the inert page behind
  the sheet). They never cover the Undo bar or Tender & Charge, nor the
  scan box except behind an open sheet; they may cover the last ticket
  rows, and a tall stack the sheet's header.
- Touch layout (#26): below `lg` (64rem, `useIsLarge`) the register has a
  sticky footer (total + Tender) that opens the tender panel as a sheet on
  the modal stack (`useTenderSheet`); the basket scrolls on its own. From
  `lg` the panel sits beside the ticket. With the sheet on top, F2/F4 close
  it and go to the ticket; F8/F9 open it first (F9 then opens the checkout).
- Crossing `lg` with the focus in the tender panel keeps it on the same
  control: shrinking opens the sheet, growing closes it without returning
  the focus to its opener.
- Seller sidebar: from `lg` it starts expanded; collapsed/expanded is kept
  in localStorage `grocery_pos_sidebar_v1:<userId>` (the only preference
  there; storage errors fall back to expanded). Below `lg` it is a modal
  drawer on the modal stack (menu button, backdrop, X, Escape, navigation
  close it); the register behind it is inert and its keys pause.
- Every register button and field is at least 44px (`min-h-11 min-w-11` or
  `w-11 h-11`), including the scan box's Clear, Enter / Scan and the Qty
  select. `BaseModal`'s header close (×) is still 32px, in every dialog.
  No text below 12px (`text-xs`); `layout-drift.spec.ts` enforces it for
  classes and CSS `font-size`.
- No third-party runtime assets: Poppins (400–900) comes from
  `@fontsource/poppins`, and the login photo is
  `public/images/login-hero.jpg`, fetched by the client Docker build (best
  effort, `LOGIN_HERO_URL`) or the README curl, over a gradient, gitignored,
  never committed.

**CI** (#28)

- `ci.yml` runs on PRs and pushes to `develop`, `staging`, `production`,
  `master`, with `contents: read` and a per-ref `concurrency` that cancels
  superseded PR runs (branch pushes never cancel). Contracts are built as an
  explicit step; contracts has no `prepare` script (the Dockerfiles install
  before copying its source).
- `pnpm audit --audit-level high` runs on every CI run but fails it only
  when `pnpm-lock.yaml` or a `package.json` changed (`dorny/paths-filter`).
  `audit.yml` runs weekly and on dispatch, failing on any high advisory.
- Coverage is a ratchet at the level measured in #28; contracts has vitest
  tests of its pure functions.
- Both Docker images are built (not pushed) only when a Dockerfile,
  `.dockerignore`, `nginx.conf.template`, `docker-entrypoint.sh`, a
  `railway.json`, a `package.json`, `pnpm-workspace.yaml` or
  `pnpm-lock.yaml` changes.
  The docker job also smoke-tests the client image (non-root, headers,
  `/health`).
- `.husky/pre-push` runs the contracts build, lint and typecheck.
- The client lints type-aware; the `no-unsafe-*` family and
  `no-redundant-type-constituents` are on since #27 (see Wire contracts).
- `pnpm-lock.yaml` is prettier-ignored. `pnpm licenses:check` scans the
  whole workspace and denies any GPL/AGPL (not LGPL), failing closed on an
  unparseable expression (`scripts/license-policy.mjs`, with a `node --test`
  spec).

**Deploy** (#29, `docs/DEPLOY.md`)

- Prod and stage need a custom domain with a shared parent (client
  `pos.example.com` + API `api.example.com`, `DOMAIN=example.com`, the same as `VITE_DOMAIN`).
  `*.up.railway.app` is a public suffix, so cookies can't be shared there. No
  cookie redesign.
- `APP_ENV` (dev|test|stage|prod) is the API's stage; prod and stage are
  "deployed" (`isDeployedEnv` in `typed-config/app-env.ts`): strict secrets,
  `DOMAIN` required, trust proxy, and `Secure` cookies on stage too. The API
  image sets `NODE_ENV=production`; no app rule keys off `NODE_ENV`. For
  one release an unset `APP_ENV` is taken from a legacy `NODE_ENV`
  (dev|test|stage|prod) with a warning; a legacy `NODE_ENV` that disagrees
  with `APP_ENV` fails startup. The client's stage is `VITE_APP_ENV`
  (#86); for one release an unset one is taken from the old
  `VITE_NODE_ENV` with a warning, and the two disagreeing fail the build.
- nginx sends a strict CSP (`script-src 'self'`, `style-src 'self'` with no
  `'unsafe-inline'`, `img-src 'self' data:`, `connect-src 'self'` + the API
  origin, `frame-ancestors 'none'`, …), nosniff, `X-Frame-Options`,
  `Referrer-Policy`, HSTS one year without `includeSubDomains`. The API
  origin defaults to the built `VITE_API_URL`'s (runtime `API_ORIGIN`
  overrides). All `add_header` lines stay at server level; per-path values go
  through a `map`. No static `style="…"` in templates (`layout-drift.spec.ts`)
  and zod runs `jitless`, so the app raises no CSP violation.
- Hashed `/assets/` are cached immutable for a year, everything else
  `no-cache`; `/health` is 503 without `index.html`.
- Both images run non-root (API as `node`, nginx as `nginx` with pid/temp in
  `/tmp`, listening on `$PORT`) and have a `HEALTHCHECK` for local use;
  Railway uses `railway.json`'s `healthcheckPath`. `VITE_*` are build args,
  inlined; a missing `VITE_API_URL`/`VITE_DOMAIN` fails the build clearly.
- `.dockerignore` patterns are `**/`-prefixed. docker compose is dev-only
  MongoDB without auth.

**Scope**

- Receipts are shown on screen only, with no printing. BIR compliance (VAT,
  official receipts, SC/PWD) is deferred to #48.
- Editing and archiving products is #38, not part of the list views.
- Open decisions and follow-ups are listed in #31.

## Status

Phases 1–7 of #31 are complete. Phase 7 (#28, #30, #27, #29) laid
foundations: CI that gates, coverage and a real-DB suite, wire contracts, and
deploy hardening. Next is the feature roadmap in #31 (#34–#48), in an order
the product owner picks.
