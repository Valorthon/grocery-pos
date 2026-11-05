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

**Measured quantities** (#36)

- Units: PIECE (default), KG, G, L. Quantities/stock on wire and in the database
  are safe integer minor units: pieces, grams for KG/G, millilitres for L.
  Display input allows 3 decimals for KG/L, whole quantities for PIECE/G.
- Price/cost remain centavos per selected display unit. Use shared quantity
  parsing/formatting and BigInt `quantityAmount` (half up per line), never
  float accumulation. 450 grams at 18,000 centavos/kg totals 8,100 centavos.
- Missing unit means legacy PIECE; existing quantities need no migration.
  Unit is immutable after product creation; sale/restock details snapshot it.
  Approval context binds unit; parked tickets reject incompatible measures.
- Stock filters and dashboard low-stock thresholds compare displayed units.
  Optional PACK and embedded scale-label parsing are deferred; no generated
  barcode-prefix reinterpretation.

**Sales**

- The discount is computed on the server by `discountAmount` in
  `packages/contracts/src/discount.ts` and needs a reason. `Sales.discount`
  records `approvedBy`. Every nonzero discount requires ADMIN approval via the
  manager username + six-digit PIN dialog (#34, product decision 2026-11-03).
  A configurable cashier allowance is deferred until the owner revisits it.
- Void and refund cover the whole sale only and require an ADMIN or SUPERVISOR
  manager approval. ADMIN may reverse any sale; a SELLER may reverse only their
  own sale in their current open shift, paying from that shift only (#34).
  They put stock back, pay cash out of a shift's drawer (see Shifts), and record
  the manager in `reversal.approvedBy`. Revenue excludes reversed sales.
- SPLIT tender stores `tenders`, `amountTendered` and `changeGiven`. A GCash
  `referenceNumber` is 13 digits, unique, and required for non-cash tenders.
- `POST /sales` is idempotent through `idempotencyKey` plus a `requestHash`. A
  replay returns the original receipt. The receipt and drawer figures always come
  from the server response.

**Physical stock counts** (#43, owner decision 2026-11-05)

- ADJUSTER/ADMIN create, resume, save and submit server-side counts. ADMIN or
  SUPERVISOR approves exact submitted count/version via username + six-digit PIN;
  this does not grant supervisor-only accounts general inventory-page access.
- Opening expected quantities are immutable. Approval applies
  `countedQty - expectedQty` to current balances, preserving all intervening net
  movements. The physical count must correspond to the opening reference;
  the UI warns that already-reflected movements cannot be inferred automatically.
- Blank means uncounted; zero is explicit. Edits use optimistic versions.
  Submit freezes quantities; approval consumes its one-use grant in the same
  transaction as one adjustment containing only nonzero variances. All-zero
  counts approve without an empty adjustment; approval retries cannot double-post.
- Expiry-tracked stock is counted per existing batch, with normal nonnegative
  batch/aggregate guards and rollback. Counts never invent expiry/opening lots;
  a tracked product without a batch can only be counted as zero. Changed product
  tracking/unit requires a new count. Existing stock/expiry/cost policies remain.
- A count contains at most 200 posting lines (including batches), so split larger
  scopes. Initial scope is active products: all, category or picked barcodes.
  Cancelled/approved counts retain their immutable snapshots and identities.

**Suppliers and latest-receipt costs** (#41)

- ADMIN and RESTOCKER manage suppliers and receipt-cost defaults. Every new
  restock requires an active supplier; invoice/DR number is optional. Existing
  receipts without supplier keep that unknown history. Archive referenced
  suppliers rather than deleting their receipt links.
- Product `lastCost` is the last received line's integer-centavo unit cost per
  displayed unit, written in the stock/receipt transaction. Repeated product
  lines resolve in receipt order. This is not FIFO or weighted-average costing.
- Sales snapshot the server's latest-receipt unit cost. Unknown stays absent;
  only explicit integer zero means free. Do not backfill historical COGS or
  report incomplete-cost margins as complete. Reversals keep the original basis.
- Cost snapshots are hidden from cashier receipts, sales detail responses and
  catalogues. Procurement default endpoints require RESTOCKER/ADMIN; margin
  estimates in product list/editor are ADMIN-only and labeled latest receipt.
- Offline cost evidence is stored server-side with an opaque signed reference.
  JWT/IndexedDB catalogue data never contains readable costs. Sync/reconciliation
  uses that immutable catalogue basis, not a later receipt's cost. Legacy proofs
  without evidence remain unknown. Retain evidence for delayed cash uploads.
- Low-stock restock drafts receive known latest costs asynchronously without
  overwriting user edits; unknown defaults retain the normal zero-cost review.
- Purchase orders are the owner-deferred second phase in #123. Reporting of
  revenue/COGS/margin and missing-cost coverage belongs to #44.

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
- Request bodies (#90) are contract types too, in `src/wire/requests.ts`
  (`SaleRequest`, `RestockRequest`, `LoginRequest`, …; `Tender` and
  `DiscountInput` stay where they were). Each body DTO and nested DTO
  `implements` its type, and `common/request-contracts.spec.ts` fails
  `tsc` on a key, or a required key, on one side only. The client's
  `payloads.ts` mappers return them and other bodies use `satisfies`; the
  client defines no request types of its own. Product edit requests share
  `UpdateProductsRequest` and nested types too (#38).
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
- Low stock is any active product at or below its own reorder level, including
  zero and negative stock (#40, owner decision 2026-11-05). The matching dashboard
  tile and reorder list share this predicate; out-of-stock (`stock ≤ 0`) may overlap.
  Both ignore archived products and orphan inventory rows. Every dashboard role
  sees stock counts; only inventory roles can follow the list link.
- `GET /sales` takes `cashier` and `dateFrom`/`dateTo`. For ADMIN they filter
  everything. For anyone else they only narrow the own-open-shift scope, and
  naming another cashier returns nothing. Sales are indexed on `{createdAt}`,
  `{cashier, createdAt}` and `{shift, createdAt}`.
- `startOfDayInZone` returns the first of two repeated midnights on a
  fall-back day (Amman 2021-10-29), searching back up to 3h.

**Sales reports** (#44, owner decision 2026-11-05)

- ADMIN-only JSON/CSV reports use event-date accounting: original sale occurrence
  (`soldAt`, else `createdAt`) for gross/discount/COGS, `reversal.at` for later
  void/refund net and original COGS. Do not restate prior sale dates. Existing
  dashboard original-sale-day exclusion remains visibly distinguished.
- Store-calendar inclusive ranges cap at 366 days. Presets use server-provided
  timezone/today; weeks start Monday. Group by day/product/category/cashier/payment
  type; SPLIT is a group, not allocated tenders. Mixed quantities stay per unit.
- Allocate sale-level discounts by exact largest-remainder cents, stable detail
  order, before product/category filtering. Group transaction counts can overlap;
  report totals count each event once. Category assignment is current, archived
  category names remain readable, and uncategorized has a stable bucket.
- COGS uses original private latest-receipt snapshots and quantityAmount. Zero is
  known, absence/null unknown; corrupt costs fail. Missing costs never become zero
  or a complete gross-margin claim. Show known/unknown event-line coverage and
  known-cost portion alongside nullable complete margin.
- Original Z-reads remain immutable; reports identify original charges, reversal
  events, prior-period reversals and late offline occurrences for reconciliation
  with original shifts, drawer payouts and closing addenda. Do not falsely claim
  calendar event totals equal unadjusted immutable closing snapshots.
- Match indexed occurrence/reversal dates before lookups and use a cursor with
  bounded group memory. Reject >10,000 groups instead of truncating. CSV has BOM,
  ISO day keys, plain exact peso decimals and formula-safe user text; numeric
  negative money stays numeric. ADMIN permissions apply to all report endpoints.
- Sales history adds payment/category/full-or-eight-suffix sale-number filters,
  preserving seller own-open-shift scoping. Suffix collisions return all matches;
  details show full IDs. Requests page/retry on applied, not unsearched, filters.

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
- The Users editor renames whoever it opens for (#106): an ADMIN anyone, a
  USER_MANAGER themselves and the users they manage, as the API allows. The
  name is trimmed and lowercased as the API stores it, length-checked on
  that (`USERNAME`), sent only when it changed, and confirmed first
  ("They/You will log in as …"). A taken name (`DB_DUPLICATE_KEY` naming
  `name`) is inline. A rename revokes no session. A self-rename shows the
  new name at once, then `authStore.renameSelf` refreshes the session
  through axios's single-flight `refreshSession` (the token carries the
  new name) and re-reads the profile; a failed refresh keeps the new name.
  Another user's token keeps the old name until it refreshes.
- `RoleGuard` fails closed: a non-`@Public()` route whose `@Roles` is
  missing or empty is 403 for everyone. `route-roles.spec.ts` finds the
  controllers by walking `AppModule`'s module metadata
  (`common/testing/app-routes.ts`, inherited handlers included) and fails
  on such a route (#61).
- ADMIN passes every `@Roles(...)` check except on `@RequireOwnRole(...)`
  routes, where only the listed roles themselves count (#84): `POST /sales`
  and the cashier's own shift routes (open, current, drawer, close,
  last-closed) need SELLER itself, matching the client's `sellerOnly`.
  Force-close, the admin sales/shift views and dashboard money stay ADMIN-only.
  Void/refund also allow SELLER for their own current-shift sales, with approval
  enforced inside the monetary transaction (#34). Contracts `PERMISSIONS` marks those rows `ownRoleOnly`,
  and `role-permissions.spec.ts` checks it against the metadata.
- Dashboard money is ADMIN-only and stripped on the server. A cashier sees only
  their own sales. Price changes are ADMIN-only.
- Only RESTOCKER (and ADMIN) add or edit products (`POST /products/bulk`,
  `GET /products/ensureValid`, `PATCH /products`); ADJUSTER keeps stock
  adjustments and product lookup (#83).
- Deactivating a user, changing their roles, or resetting or changing a password
  revokes that user's sessions. Login is rate-limited, and all login failures
  return one generic 401. Passwords are at least 8 characters.

**Manager approvals** (#34)

- Manager credentials are a username plus exactly six decimal PIN digits,
  with leading zeroes preserved. Only an ADMIN can set/reset/remove a PIN,
  from the Users list. PIN hashes and versions are never returned to clients.
- Every discount requires an ADMIN PIN. ADMIN or SUPERVISOR may approve a
  reversal. SUPERVISOR adds approval authority only, no selling, dashboard or
  user-management access; combine it with another role for app access.
- The cashier stays logged in. The modal issues a signed 60-second approval,
  bound to the requesting session, action and exact monetary context. Tokens
  live in memory only. MongoDB consumes the grant in the same transaction as
  the sale/reversal, so rollback restores it and concurrent uses cannot both
  succeed. An idempotent checkout replay needs no new approval.
- Current requester/approver roles and activation are checked inside the
  transaction. PIN reset/removal, role/activation edits and password changes
  invalidate pending approvals. Every approved action records the manager's
  `approvedBy`; audit-log presentation remains #46.
- Unsold basket edits remain normal register actions. Partial/per-line refunds
  remain deferred. The original configurable discount threshold proposal is
  superseded by the owner's all-discounts-admin decision for now.

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
- Change password (#88) is in the profile menu of both layouts
  (`UserProfileMenu`, `ChangePasswordDialog`). A wrong current password
  (`USER_WRONG_PASSWORD`, a 403) is inline; a success logs out through
  `requestLogout(notice)`, so a draft page may ask, and Login shows a
  success toast, never "Please log in to continue".
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
- The one exception: `queueMessage(color, text, { sticky: true })` keeps a
  success/info toast until dismissed, only for a notice that asks for a
  later action (the change-password "Stay" notice, #88).
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
- The admin `UserSidebar` is the same drawer below `lg`, and below `md`
  the seller dashboard header's tabs are in a menu drawer (#89). All three
  are `role=dialog` + `aria-modal` only while they are drawers, and use
  `useModalDrawer`: the page behind is inert, the focus goes back to the
  menu button, growing past the breakpoint closes the drawer, and an
  unmount while open (e.g. Back swapping the layout) leaves nothing on the
  stack and puts the focus on the new `<main>`, never `<body>`.
- Every register button and field is at least 44px (`min-h-11 min-w-11` or
  `w-11 h-11`), including the scan box's Clear, Enter / Scan, the Qty
  select and `BaseModal`'s header close (×) in every dialog (#89); so
  are the admin app bar's Add Product/Restock/Adjust, the `UserProfileMenu`
  bar and rail (`icon`) triggers, the seller dashboard tabs, and the Cash
  In/Drop quick amounts (two columns below `sm`, four from `sm`) (#107).
  Below `sm` the admin bar tightens its padding and gaps to fit at 320px. The
  scan box hides its F2 hint below `sm`, and its right padding fits its
  buttons: `pr-32 sm:pr-48` empty, `pr-43 sm:pr-52` with Clear. No text
  below 12px (`text-xs`); `layout-drift.spec.ts` enforces it for classes
  and CSS `font-size`.
- No third-party runtime assets: Poppins (400–900) comes from
  `@fontsource/poppins`, and the login photo is
  `public/images/login-hero.jpg`, fetched by the client Docker build (best
  effort, `LOGIN_HERO_URL`) or the README curl, over a gradient, gitignored,
  never committed.

**Parked tickets** (#35)

- First iteration is local to this browser and cashier; no server draft
  collection or stock reservations. Up to 50 parked tickets include label,
  timestamp, original shift, full lines and discount; never credentials,
  approval tokens or checkout attempts.
- Active and parked drafts share one atomic storage record. Parking/resuming
  requires a successful durable write; quota failures keep the source intact.
  Logout clears the active basket and in-memory drafts while preserving parked
  drafts for that cashier's next login. Another cashier never inherits them.
- Resume requires an empty active basket and open shift. Fetch every product
  and current price; any missing/reused product or invalid/over-cap total
  preserves the entire parked draft. A late answer after logout, shift close,
  unmount or another tab's change cannot overwrite the current basket.
- A checkout attempt that may already be recorded cannot be parked. Resumed
  discounts need fresh ADMIN approval at checkout (#34).
- Shift close warns about parked drafts and requires explicit discard or carry
  to the cashier's next shift. Apply that choice only after server close
  succeeds; a local persistence failure reports the closed shift accurately
  and retains the drafts for review. Discarding one parked ticket asks first.
- Cross-terminal drafts are deferred, as the optional second iteration in #35.

**Offline cash** (#37, owner decisions 2026-11-03)

- Preserve server-attested cached prices after collecting cash. A dedicated
  signed-catalog/lease path records offline CASH only, never discounts, GCash,
  overrides, voids or refunds. Ordinary `POST /sales` remains server-priced
  and cannot oversell. Capabilities bind cashier/session/shift/product/unit/
  price and expire no later than the login session.
- Public shell assets are precached by the service worker; no API/auth response
  or user data is cached there. IndexedDB holds per-cashier catalogue, lease
  and atomic outbox. Cash receipts become durable before the basket clears.
  Logout never deletes queued cash, and another cashier never inherits it.
- Wait for “Offline cash ready” before disconnecting. An unresolved online
  checkout cannot be silently converted into an offline receipt. Outbox retries
  reuse one key, and delete only after an exact confirmed server receipt.
- Completed offline cash may drive stock negative and flags stock reconciliation;
  the private inventory marker distinguishes this from corrupt stored stock.
  Original `soldAt` is separate from server `createdAt`; receipt/history and
  daily reporting use occurrence time.
- Each terminal registers a server lease. Normal close requires all terminal
  queues drained and leases released, including cross-tab enqueue suspension.
  ADMIN may force-close; revoked cashiers/sessions or closed shifts require
  explicit ADMIN reconciliation on the terminal with a reason. Saved Z-read
  figures never change; late uploads appear in a separate report addendum.
- Native IndexedDB/service worker APIs add no runtime dependency. Fake IndexedDB
  is test-only. Signed 200-line upload bodies have a scoped 256kb limit; other
  API routes retain their existing 100kb JSON limit.

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
- CSP violations are reported to the API's public `POST /v1/csp-report`
  (#94), which logs one warn line per report (request id, directive,
  blocked and document URI without query strings; never the body or
  cookies) and answers 204. nginx sends `report-to csp-endpoint` +
  `report-uri`, with `Reporting-Endpoints`, both on `API_ORIGIN`, and
  `Permissions-Policy` denying camera, microphone, geolocation, payment and
  usb. The route parses only `application/csp-report` and
  `application/reports+json`, 16KB max, on that route alone (global parsing
  is unchanged), and is rate-limited per IP (`RATE_LIMITS.cspReport`) by
  `CspReportLimiter`, which `useBodyParsers` installs ahead of every parser
  so refused bodies count too (#108). A violation (its three logged
  fields) is logged once per 60s window, its repeats summarised in one line
  at the window's end (`CspReportLog`, at most 1000 tracked per window).
  The limiter's 429 is answered as usual but not logged per request
  (`loggedByRaiser` in `global.filter.ts`, opt-in per error): it is counted
  per client IP and logged as one line per IP per window, naming the IP (at
  most 1000 IPs, then one overflow line).
  A parser 5xx keeps the original error as a non-enumerable `cause` for the
  log; the response stays fixed.
  Chromium's `report-to` upload is a CORS preflighted request without
  cookies, allowed by the API's `FRONTEND_URL` CORS; no third party.
  Body-parser failures answer and log a fixed message per error `type`
  (`BODY_ERROR_MESSAGES` in `global.filter.ts`), never the parser's own
  message; the global parsers are installed by `useBodyParsers`
  (`common/body-parsers.ts`, `bodyParser: false`) so Nest can't turn a
  JSON SyntaxError into a message-quoting BadRequestException.
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
- Product editing and archival are implemented in #38; unit remains immutable.
- Open decisions and follow-ups are listed in #31.

## Status

Phases 1–7 of #31 are complete. Phase 7 (#28, #30, #27, #29) laid
foundations: CI that gates, coverage and a real-DB suite, wire contracts, and
deploy hardening. Next is the feature roadmap in #31 (#34–#48), in an order
the product owner picks.

**Product editing and archival** (#38)

- RESTOCKER/ADMIN may edit names/categories and archive/restore products. Selling
  price changes remain ADMIN-only, including API enforcement. Immutable units
  remain #36's rule; reorder levels stay #40.
- Active is the default; a missing legacy isActive field means active. Archived
  products remain in historical records and stock; no hard delete exists. New
  online checkout and scan reject discontinued products, while register matches
  hide them. Management lists expose active/archived/all filters.
- Product edits are transactional. Actual price changes append private old/new
  centavos, actor and timestamp history in the same transaction. Internal history
  and checkout conflict versions are excluded from every response, including raw
  inventory/restock/adjustment aggregation joins; audit-log presentation is #46.
- Transactional product writes serialize checkout pricing with archival/edits.
  Offline catalog pages retain archived cursor entries as tombstones with empty
  proof; clients remove cached availability. Already-collected signed offline
  receipts still sync/reconcile under #37's policy.

**Categories** (#39)

- ADMIN manages category names, sort order and archive/restore. Product roles
  can read bounded category lists for forms/filters; prices stay ADMIN-only.
- Product category is an optional ObjectId. New assignment locks an active
  category in the product transaction, serializing archive/delete with assignment.
  Unchanged archived assignments and explicit clearing remain valid. Category
  archival does not archive products or stop their sale. Referenced categories
  cannot be deleted, including references from archived products.
- Name keys are unique case-insensitively and private. Category wire responses
  omit internal assignment counters. Product lists filter by category id.
- Before deploy, stop the API, back up, dry-run/apply `migrate:categories`, then
  deploy the matching API/client. Legacy enum strings map atomically to reusable
  category documents; unknown strings fail before writes and reruns are safe.
  See README. Category reporting integration stays #44.

**Reorder planning** (#40)

- `reorderLevel` and `reorderQuantity` use safe integer minor units, like stock.
  Legacy missing settings default to ten displayed units (10,000 grams for KG,
  10,000 mL for L, ten pieces/grams otherwise). Level may be zero; restock
  quantity must be positive. RESTOCKER/ADMIN may edit these without gaining
  ADMIN-only selling-price permissions. No migration or stock write is needed.
- Low-stock list includes zero/negative levels and sorts by displayed-unit
  shortfall descending, then product name and row id. Paging preserves that order.
  Dashboard counts, sidebar badge and list use the same per-product thresholds.
- Restock listed items transfers the current page into an unsaved draft with the
  configured quantities. It never reserves/writes stock and cannot replace an
  existing draft silently. Handoff is in memory, consumed once and cleared on
  account change. Review actual unit costs before saving; zero-cost lines retain
  the existing explicit confirmation. Supplier pricing belongs to #41.

**Expiry and batches** (#42, owner decisions)

- Expiry tracking is optional and legacy products remain untracked. Enable or
  disable it only at zero aggregate stock before any batch history exists. Once
  lots exist, keep tracking enabled so an expired return cannot become sellable;
  retain all historical lots. New tracked receipts require a real calendar expiry
  date; batch number is optional. Quantities remain integer minor units.
- Online sale consumes unexpired lots FEFO (date, received time, id), recording
  private allocations in the sale transaction. A printed expiry day remains usable
  through the end of that day in STORE_TIMEZONE. Expired and undated reconciliation
  lots are never online sellable. Aggregate stock still has its guarded decrement.
- Returns restore original lot allocations, including expired lots which stay
  blocked. A legacy unallocated return is quarantined without inventing expiry.
  Batch adjustments require an explicit lot, including write-offs; the prefilled
  adjustment is reviewed and saved through the ordinary draft flow.
- Expiry-tracked products are online-only for new cash sales. Catalogue cursor
  entries remove their offline availability. Previously collected signed offline
  cash remains recoverable through ADMIN reconciliation, creating an explicit
  undated negative reconciliation batch; its retries remain idempotent.
- Every tracked stock transaction verifies sum(batch.remainingQty) equals the
  aggregate Inventory.stock, including deficit/reconciliation balances. Batches
  and aggregate changes roll back together. Costing remains latest receipt (#41),
  not lot/FIFO valuation. Expiring view includes already-expired lots; dashboard
  alerts count remaining lots expired or expiring within seven store days.
