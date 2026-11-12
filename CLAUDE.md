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
`apps/api/jest.config.ts`, vitest `thresholds` in the client and contracts
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

**Purchase orders** (#123, owner decisions 2026-11-06)

- RESTOCKER and ADMIN create, edit, send, cancel and receive POs
  (`/purchase-orders`), no PIN. Lifecycle DRAFT → SENT → PARTIALLY_RECEIVED →
  RECEIVED / CANCELLED. SENT is a status only (no email/print) and locks lines;
  only DRAFT is editable (PATCH replaces supplier/note/lines). Drafts are
  cancelled, never deleted. Cancelling after a partial receipt sets
  `closedShort`; received stock stays and outstanding reads 0.
- A PO line is one distinct active product with integer minor-unit
  `orderedQty`, centavo `expectedCost` per displayed unit and a unit snapshot.
  Create, edit and send need an active supplier; open (SENT/PARTIAL) POs of an
  archived supplier stay receivable and cancellable (`assertExists` instead of
  `assertActive`). A supplier referenced by a PO can't be deleted.
- No stock moves before receipt. Each receive is exactly one supplier restock
  (`Restock.purchaseOrder`) through `RestockService.restock` in the same
  transaction, so #41 lastCost, #42 batches/expiry and #45 ledger apply
  unchanged. Invoice/DR optional; description defaults to the PO suffix.
  Receipt cost is prefilled from the expected cost, editable, variance shown,
  ₱0 confirmed. Over-receipt is refused (cap = outstanding per line).
- Concurrency: every write filters on `version` + allowed statuses and
  increments it; a stale or concurrent receive is 409 and rolls back its
  restock. A receive's `idempotencyKey` is stored in `receipts[]` with a
  `requestHash` of the normalized body (actor, PO, version, invoice,
  description, lines by line id), as `POST /sales` does; neither is on the
  wire. Same key + same hash replays (also for a concurrent retry that lost
  the version race); same key + other body is 409
  `SALE_IDEMPOTENCY_MISMATCH`. The client reuses the key only for an
  unchanged body after a lost answer, makes a new one after any edit or
  HTTP refusal, and reloads the PO after a 409. The list uses `BaseTable` +
  `useListPaging`/`useListFetch`/`useAppliedFilters`.
- A DRAFT adds lines through an Add product button in the "Lines" card
  header and in the empty table ("No products yet"), opening
  `PurchaseOrder/AddLineDialog` (product, Ordered, Expected cost
  prefilled from the latest receipt without overwriting a typed cost),
  validated inline like the line rules (#284). Picking a product already
  on the order edits that line (Edit line / Update), never a second one.
- Low-stock list offers "Create purchase order" beside "Restock listed items"
  via a consume-once in-memory handoff (`purchaseOrderPrefill`) with reorder
  quantities; known latest costs fill untouched lines asynchronously.
- References are `purchaseOrderReference` (`PO-` + last 8 of the id, upper
  case), shown on the PO page and in the default receipt description.
  Restock History shows the linked PO (a link to it when the viewer may open
  Purchase Orders) and filters by `purchaseOrder` (GetAll DTO /
  `RestockListQuery`, deep link `?purchaseOrder=` from "View receipts",
  cleared by Clear Filters). `/purchase-orders?id=` opens one order.
- A draft whose supplier is archived or that has archived products
  (`productActive: false` on the line) shows a warning in the list and the
  editor (`draftSendBlockers`); sending still refuses it. ₱0 expected cost
  on a draft needs no confirmation (only at receipt).
- PO screen layout (#275): the title is "New purchase order" or the
  reference, with the status badge beside it (PageFrame `badge` slot).
  Back to list and the state's actions sit in the page header (draft: Save
  draft, Mark as sent, Cancel order; SENT/PARTIAL: Receive, Cancel order;
  RECEIVED/CANCELLED: none). A draft has a Supplier/Note band, the Add
  product row above the lines, a Line total column (`quantityAmount`), an
  in-table "No lines yet" row and Expected
  total as the table footer. An existing order shows a #260-style heading
  (supplier, total), a muted meta line (created in store time, by, Closed
  short, View receipts) and the note when set.
- Every PO action (create, edit draft, send, cancel, receive) writes an
  allowlisted `PURCHASE_ORDER.*` audit entry in the change's transaction
  (#123 round 3): reference, supplier, status, version, `lineCount`, `lines`
  as `product:orderedQty:expectedCost` (receive: `product:quantity:unitCost`
  plus `restock` and `invoiceNumber`), `closedShort` on cancel. Never the
  note, idempotency key or request hash. A receive replay adds no entry.

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
- Scanners outside the register (#214, owner decisions 2026-11-10) are
  keyboard wedges only, no camera. Products/Inventory searches: a
  barcode-shaped term (`isBarcode`, check digit not enforced) + Enter
  opens its exact product, archived too, via
  `GET /products/:EAN?includeArchived=true` (same roles; without the flag
  an archived product is still refused) (Products: Edit for RESTOCKER/ADMIN, else
  Stock history; Inventory: Stock history), else the normal search.
  Restock, adjustments, stock counts and the DRAFT PO editor capture scans
  page-wide with `useBarcodeCapture` (digits at most 200 ms apart + Enter,
  generous for slow Bluetooth wedges; not in
  text/number/select fields, IME, key repeats or while a modal is open).
  Restock/adjustment scans open the add dialog as a new line (archived is
  refused; an unknown restock code opens a new product only if
  `barcodeError` passes). The PO applies scans in order: a product not on
  the order opens its Add product dialog with it picked (#284), a repeat
  is +1 piece and a measured unit focuses its line's quantity; a scan
  while the dialog is open is ignored. Counts focus the first uncounted
  matching line. Never mounted on the register.
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
  timezone/today; weeks start Monday. A preset applies at once; manual date
  and Group by/Cashier/Payment/Category changes wait for Run report. Clear
  Filters (after Run report, at the end of the compact row, #254) resets to
  Today with day grouping (#215). Cashier/Payment/Category sit in the
  Filters dialog. Group by day/product/category/cashier/payment
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
- Dashboard money and today's sales count are ADMIN-only and stripped on the
  server (#213). Total Products counts active products. A cashier sees only
  their own sales. Price changes are ADMIN-only.
- Only RESTOCKER (and ADMIN) add or edit products (`POST /products/bulk`,
  `GET /products/ensureValid`, `PATCH /products`); ADJUSTER keeps stock
  adjustments and product lookup (#83).
- Step-up re-auth (#310, owner decision 2026-11-12): creating any user,
  resetting another user's password, an actual role change (compared with
  the stored roles), an actual deactivation and setting/resetting/removing a
  manager PIN need the actor's own password re-entered via
  `POST /auth/reauth` (any signed-in role, the password-change rate
  limits, 204). It records a `StepUp` `{user, sid, expiresAt}` (TTL index)
  valid `STEP_UP_TTL_S` (5 min) from the re-auth, never extended. Guarded
  writes call `StepUpService.assertLive` inside their transaction, which
  also requires the session's refresh-token family to exist; otherwise
  403 `USER_REAUTH_REQUIRED` (never a 401). Renames, unchanged roles,
  `isActive: true` and reactivation are unguarded; a bulk PATCH is guarded
  if any entry is. A token without `sid` can't step up (403 FORBIDDEN, log
  in again). Logout and every `revokeAllForUser(s)` delete the step-ups. A
  wrong password is 403 `USER_WRONG_PASSWORD`. Client: `useReauth()`
  (`withReauth(run)`) + `ReauthDialog` ("Confirm it's you", "Your
  password") retry the save once after success; Cancel saves nothing and
  keeps the edit dialog. Used by Add/Edit User and `SetManagerPinDialog`.
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

**Sensitive-action audit log** (#46, owner decision 2026-11-05)

- ADMIN alone reads `/audit` and the Audit Log screen. USER_MANAGER has no audit
  access. Pagination and actor/action/store-day filters are validated; the UI
  pages and retries applied filters and ignores stale responses after access changes.
- No automatic deletion or TTL is configured initially. Future retention or archive
  work requires an owner decision; this feature adds no archive/export/delete action.
- Explicit service calls record user creation/name/roles/activation/password/PIN
  changes, product price changes, discounts, voids/refunds, shift open/close/force-close,
  cash in/drop, purchase-order create/edit/send/cancel/receive (#123),
  handled successful/failed credential logins, and step-up re-auths
  (`AUTH_REAUTH`/`AUTH_REAUTH_FAILED`, actor and target the user, `name`
  only, never the password, #310). Replays do not
  duplicate completed-sale events. Existing history is not backfilled or invented.
- Where state is transactional, the audit entry shares that transaction; opening
  shifts, drawer movements and own-password writes also use a transaction so an
  audit failure cannot leave those state changes unaudited. Index initialization is
  awaited at startup. Failed/throttled requests that never reach credential checking
  are not successful business changes; credential failures retain generic responses.
- Before/after fields are positively allowlisted per action. Password/PIN changes
  record only boolean facts, never values, hashes, session IDs, tokens, cookies,
  raw documents or request bodies. Actor names are signed-request snapshots;
  unknown login actors remain null, with only bounded attempted username text.
- Request metadata contains only bounded user-agent and Express-resolved client IP,
  honoring existing deployed trust-proxy configuration. It never retains headers
  or credential bodies. Manager approval identity is separate from the acting user.
- Append-only guards reject model/document update, delete, replace, save-existing
  and bulk-write operations. This is application/model-level immutability, not
  protection against a privileged direct MongoDB administrator.

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
- Dialog footers (#282): `BaseModal`'s footer is right-aligned
  (`justify-end`), Cancel then the primary action, with no `flex-1`
  buttons, in every dialog using it (Restock Add and the PO receive dialog included); only Receipt and Z-read keep
  full-width `flex-1` buttons and DateRangeFilter its `ml-auto` Done.
  A submit or server error goes in `BaseModal`'s `error` prop (with
  `errorTestid`), a full-width `role=alert` danger row pinned in the
  footer above the buttons, height-capped so the body still scrolls
  (#321): Shift In/Out, Checkout, force-close, PO Receive and Pending
  offline cash sales use it. Field errors stay inline; toasts stay toasts.
- Edit Product (#282) groups Details, Pricing (ADMIN only, the
  latest-receipt summary beside the price) and Stock planning under a
  header of barcode, unit badge (unit can't change) and status (display
  only; Archive/Restore stays in the row menu). Client checks are inline
  per field, and a taken name (`isDuplicateName` in `utils/api-error.ts`,
  shared with the Users editor) shows "A product with this name already
  exists" under the name; other failures are toasts. The expiry box is
  disabled ("Only at zero stock") while the integrity check reports
  nonzero stock; batch history isn't visible to the client, so the
  server stays the final check. An ⓘ sits 4px after its label
  (`-ml-3.5` after `gap-1`, `-ml-3` in table headers).
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
- Filter bars (#215): `FilterBar` is one inline, wrapping row: the search
  box with its Search button, the filters, then Clear Filters at the end
  (no Filters toggle, panel or chips). Clear is enabled only while a filter
  is entered, applied, a date preset or a deep link (Restock `?source=` and
  `?purchaseOrder=`, Adjustments `?source=`, Inventory `?lowStock=`,
  `?outOfStock=` and `?expiring=`), and clears those too. A deep link shows
  a muted line above the table (`data-testid="deep-link-note"`), e.g.
  "Showing receipts for PO-…" (owner-default assumption, reversible).
  Purchase orders and Users have no Clear button. In the labelled row each
  slotted input or select stops at `max-w-64` (16rem) and the search box is
  uncapped; a `SegmentedFilter` (`data-segmented`) is exempt and wraps
  (#261). Purchase orders filter status with `SegmentedFilter` chips (All ·
  Draft · Sent · Partially received · Received · Cancelled, labels from
  `STATUS_LABELS`, "All" is `''` and sends no status) inside the card,
  with no FilterBar; a tap applies on page 1 with one load.
- Compact filter rows (#254, owner decision 2026-11-11; supersedes #215's
  "no Filters toggle, panel or chips" on these screens): Sales, Adjustments,
  Restocks, Audit and Reports use `FilterBar compact`: one aligned row of
  44px controls (`COMPACT_HEIGHT` in `filter-bar.ts`) with no labels above
  them (aria-labels, placeholders and "All …" options name them): search +
  Search, one `DateRangeFilter`, the main filter (Sales Payment,
  Adjustments Adjusted By, Restocks Restocked By, Audit Action, Reports
  Group by), a "Filters · N" button (`more` slot, a BaseModal on the modal
  stack; N = the page's applied filters in it; omitted when the slot is
  empty: Sales Cashier/Category for ADMIN, Reports Cashier/Payment/Category),
  the `actions` slot (Reports' Run report), then Clear. Below `sm` the
  search has its own line. Other FilterBar screens keep the labelled row.
- `DateRangeFilter` is a button naming the preset or range ("Today",
  "Nov 1 – Nov 11") that opens the presets and From/To in a dialog; it
  stays open after a pick (Done/Escape close it). Specs open it with
  `openDates()` / `openMoreFilters()` from `testing/form-dom.ts`.
- Dated lists (Sales, Restock, Adjustments, Audit) have a "Dates" preset
  select before From/To (`useDatePreset`, `Reports/presets.ts`): Today,
  Yesterday, This week, Last week, This month, Last month, Last 30 days,
  Custom; "All dates" (none) is the default. A pick reads the store date
  from `GET /settings/today` (every role, `StoreToday`), fills both dates
  and applies once on page 1; a manual edit switches to Custom; Clear
  resets it. Weeks start Monday.
- Requests read the last applied filters (`useAppliedFilters`, or the
  `applied` snapshot on restock/adjustment history), so paging, a page-size
  change and Retry never send typed-but-unsearched text.
- A reversed date range (`dateFrom` after `dateTo`) is a 400 from the
  restock, adjustment and sales GetAll DTOs (`@IsNotBefore('dateFrom')`).
  The client shows `dateRangeError` on the To field and keeps the last
  valid range; a user-select change still applies with it.
- BaseTable hides its pager while `error` is set.
- Restock and Adjustment Details (#260) open with a heading line. Restock
  shows the supplier and the grand total; Adjustment shows the description
  (a count approval as "Stock count 1A2B3C4D", linked for ADJUSTER/ADMIN)
  and the line count of an unsearched load. A muted meta line joined by
  "·" follows (invoice · PO link · restocker · date; adjuster · date).
  Empty values are left out (rows carry `undefined`; the history tables
  keep their placeholders); a legacy receipt shows muted "Unknown
  supplier"; the default `Purchase order PO-…` description is hidden. One
  compact "Search name or barcode" box (`productSearchParams`: up to 13
  digits is an `EAN` prefix, else `name`).
- Sale details clear before loading, and only the latest click's answer is
  shown. The user editor edits a copy of the row's roles, so Cancel changes
  nothing. Create validates name (trimmed), password and roles like
  `CreateFields`; a field's error clears when it is edited.
- Dashboard recent activity is sorted on raw timestamps, then cut to 7.
- Row actions (#311, owner decision 2026-11-12): a row with a destination
  opens by BaseTable `row-click` / `@click:row` (Inventory → Stock history,
  PO/Stock counts → the order/count, Suppliers/Categories/Users → Edit,
  Products → Edit for editors else Stock history, Audit → the event); no
  open-only column or button (`RowOpenButton` is gone). A row the viewer
  can't open isn't clickable (`rowClickable`), and its ⋯ menu shows the
  item disabled with a `reason`. Everything else is one ⋯ `RowActions`
  menu (even for one item) in a right-aligned last column titled
  "Actions" (key `actions`), with only the viewer's items; a row with
  none shows no ⋯, and the column is dropped when no row has any (e.g. a
  RESTOCKER on Batches). Danger items keep their confirmations. Draft
  tables use `DraftRowActions` (pencil + trash) under a right-aligned
  "Actions" (PO draft lines: trash only, "Remove <product>"). The register
  ticket is separate. `layout-drift.spec.ts` refuses "Open"/"Details"/
  "History"/"Action" headers (Audit's `action` data column excepted) and a
  non-right-aligned `actions` column.
- Column help (#263): a `TableHeader` may carry `help` (text or
  `{term, meaning}[]`); BaseTable renders an ⓘ `InfoTooltip` (#258,
  popover top layer, "About {title}", 44px with `-my-3`) after the title
  in every column, right-aligned too (#272). An ⓘ always follows its
  label/title, never precedes it. Only non-obvious columns get help;
  a status, type or role column lists every value. Texts live in `.ts`
  modules beside the badge maps (`purchase-order.ts`, `sale-status.ts`,
  `inventory-help.ts`, `stock-count-help.ts`, `Reports/column-help.ts`,
  `views/User/list-help.ts`), built with `statusHelp`/`enumHelp` so a new
  value without a meaning fails to compile; `column-help.spec.ts` checks
  the lists. Help hides with its column; Inventory's Stock also explains
  the statuses shown under it below `sm`. Specs read header titles with
  `headerText` (`testing/form-dom.ts`).
- Field help (#273): `BaseInput` takes `help` (and an optional
  `helpLabel`, default "About {label}"); the ⓘ sits after the label,
  outside it (so a click never focuses the input), with `-my-3`. Edit
  Product's Low stock at and Restock amount use the shared
  `INVENTORY_HELP.reorderLevel`/`reorderQuantity` texts.
- Page summaries (#262): every admin page shows a one-line summary under
  its title from the route's `meta.description` (a `queryTitle` may carry
  its own, e.g. Low stock), via `routeDescription` in PageFrame; at most
  110 characters, true for every role that opens the page. A
  `description` prop wins (the dashboards' greeting). Login, Page not
  found, the register and the dashboards' routes have none.

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
- Seller sidebar (#161): the one seller navigation, on every seller page
  including the dashboard (no separate dashboard header), dark leaf like
  the admin sidebar (`focus-ring-inverse`, `UserProfileMenu tone="dark"`).
  From `lg` it starts expanded; collapsed/expanded is kept
  in localStorage `grocery_pos_sidebar_v1:<userId>` (the only preference
  there; storage errors fall back to expanded). Below `lg` it is a modal
  drawer on the modal stack (menu button, backdrop, X, Escape, navigation
  close it); the register behind it is inert and its keys pause.
- The admin `UserSidebar` is the same drawer below `lg`. Both are
  `role=dialog` + `aria-modal` only while they are drawers, and use
  `useModalDrawer`: the page behind is inert, the focus goes back to the
  menu button, growing past the breakpoint closes the drawer, and an
  unmount while open (e.g. Back swapping the layout) leaves nothing on the
  stack and puts the focus on the new `<main>`, never `<body>`.
- Every register button and field is at least 44px (`min-h-11 min-w-11` or
  `w-11 h-11`), including the scan box's Clear, Enter / Scan, the Qty
  select and `BaseModal`'s header close (×) in every dialog (#89); so
  are the admin app bar's Add Product/Restock/Adjust, the `UserProfileMenu`
  bar and rail (`icon`) triggers, the seller sidebar links, and the Cash
  In/Drop quick amounts (two columns below `sm`, four from `sm`) (#107).
  Below `sm` the admin bar tightens its padding and gaps to fit at 320px. The
  scan box hides its F2 hint below `sm`, and its right padding fits its
  buttons: `pr-32 sm:pr-48` empty, `pr-43 sm:pr-52` with Clear. No text
  below 12px (`text-xs`); `layout-drift.spec.ts` enforces it for classes
  and CSS `font-size`.
- No third-party runtime assets: Instrument Sans (UI) and Bricolage
  Grotesque (display, and the ₱ sign via a `U+20B1`-only `Peso Sign` face)
  come from `@fontsource-variable/*` (#153), and the login photo is
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
  `package.json`, `pnpm-workspace.yaml` or
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
  image sets `NODE_ENV=production`; no app rule keys off `NODE_ENV`, and
  it is never read as the stage: an unset or invalid `APP_ENV` fails
  startup. The client's stage is `VITE_APP_ENV` (#86); the old
  `VITE_NODE_ENV` is not read (the one-release fallbacks were removed).
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
  Railway uses the healthcheck in `.railway/railway.ts`. `VITE_*` are build args,
  inlined; a missing `VITE_API_URL`/`VITE_DOMAIN` fails the build clearly.
- `.dockerignore` patterns are `**/`-prefixed. docker compose is dev-only
  MongoDB without auth.
- Railway service settings live in `.railway/railway.ts` (#92), not the
  deprecated `railway.json`: per environment (`staging` from `staging` on
  `app.staging.pos.valorthon.store` + `api.staging.pos…` (cookie domain
  `staging.pos.valorthon.store`), `production` from `production` on
  `app.pos.valorthon.store` + `api.app.pos…`, sibling cookie parents so neither environment's
  cookies reach the other) the `api`, `client` and `mongo` services, Dockerfiles,
  watch patterns, healthchecks, domains and volume. Variables stay unmanaged in
  Railway. Apply with `railway config plan|apply --environment <env>`.
  MongoDB is a keyfile-auth single-node replica set on a volume, private
  network only. Deployed `HEALTH_HEAP/RSS_THRESHOLD` are 300/400 MB.

**Scope**

- Receipts are shown on screen only, with no printing. BIR compliance (VAT,
  official receipts, SC/PWD) is deferred to #48.
- Product editing and archival are implemented in #38; unit remains immutable.
- Open decisions and follow-ups are listed in #31.

## Status

Phases 1–7 of #31 are complete. Phase 7 (#28, #30, #27, #29) laid
foundations: CI that gates, coverage and a real-DB suite, wire contracts, and
deploy hardening. The feature roadmap in #31 (#34–#47, plus purchase orders
#123) is merged. Open: #48 (BIR compliance, deferred), #92 (first-deploy
Railway checks, owner) and #93 (two dev-tool-only Dependabot alerts waiting
on upstream fixes).

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

- UI wording (#274, owner decision 2026-11-11): `reorderLevel` is shown as
  "Low stock at" (Inventory column, Stock history tile, Edit Product, ⓘ
  "About low stock at"), `reorderQuantity` as "Restock amount"; prose says
  "low stock level" (Settings: "Default low stock level for new products").
  API, wire and code names are unchanged. `low-stock-wording.spec.ts`
  refuses "reorder" (not part of an identifier) and "Restock quantity" in client source text.

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
  alerts count remaining lots expired or expiring within the store's
  `expiryAlertDays` (Store settings, ADMIN, 1–90, default 7; a legacy row
  reads 7). The tile and the Expiring list share one query and both skip
  archived products (#213).

**Stock movement ledger** (#45, owner decision 2026-11-05)

- Every stock writer appends its signed minor-unit movement in the stock transaction;
  count approval posts COUNT once, and reversals post VOID/REFUND against the sale.
  Product sequence is posting order. Offline occurrence time is separate from posting
  time; date filters use posting days. No update/delete API exists.
- Before deploying to existing data, stop all API writers and run the stock-ledger
  dry run, then apply. Reconstruct known receipt/adjustment/count/sale/reversal facts,
  with an explicit unattributed OPENING gap equal to current stock minus known net
  movements. Historical balances are derived, not audited historical certainty;
  missing actors remain unknown. Never invent attribution or silently repair drift.
- Live first use can establish an explicit unattributed opening for a new/unmigrated
  product, but migration refuses existing live ledger rows. Complete the historical
  migration before deploying writers when historical reconstruction is required.
- Inventory roles see quantities and permitted source links, never procurement costs
  or unrestricted sales finances. Integrity compares ledger sum to inventory in one
  snapshot and reports discrepancies without changing either side.
- Stock history header (#258): tiles for Current stock (the integrity
  check's server `stock`, never the row's), Low stock at and EAN (Inventory
  and Products pass the same `ean`/`reorderLevel` props), then a Ledger badge:
  "Reconciled", "Mismatch" (both figures and "Investigate before posting
  more stock", `role=alert`) or "Unavailable" with "Retry check" (stock
  tile "—"). Integrity loads once on open, apart from the movements page, so
  either can fail alone. The balances note is an ⓘ `InfoTooltip`
  (`components/ui`, hover/focus/tap, `aria-describedby`): a manual
  `popover` in the top layer placed by `:style`, so overflow containers
  never clip it; `items` (`{term, meaning}[]`) renders a `<dl>`; while it
  shows, Escape from anywhere closes only the tooltip (a prevented capture
  listener the modal stack ignores). Dates are `DateRangeFilter` + `useDatePreset` in a compact
  `FilterBar` (apply at once on page 1, Clear Filters resets); the API keeps
  `from`/`to`. The Low stock at tile has an ⓘ with the shared
  `INVENTORY_HELP.reorderLevel` text via `StatTile`'s `help` prop; tile ⓘ
  triggers carry `-my-3` so every label row is one text line tall (#271).

**Store settings** (#47, owner decision 2026-11-05)

- Currency remains PHP only; existing centavos are never relabelled as another currency.
  Every nonzero discount continues to require ADMIN PIN approval.
- Authenticated users read settings; ADMIN alone updates an optimistic version, with
  the settings change and allowlisted audit entry committed together.
- The database singleton initializes from the deployment STORE_TIMEZONE. All runtime
  store-calendar reads use the committed database timezone without a process cache.
  Timezone changes require no open shifts and no active offline leases; context
  creation and updates serialize through the settings row.
- New receipts, offline leases and closed Z-reads snapshot store identity and timezone.
  Existing snapshots remain unchanged; legacy receipts without snapshots display
  current last-known identity. Legal/BIR printing remains separate scope.
- The default reorder level is whole displayed units for newly created products only;
  explicit existing levels and the legacy default remain unchanged.
- A bounded terminal label is device-local presentation only, with no permission
  significance. Offline store identity uses last-known authenticated presentation;
  API responses are never cached by the service worker.
