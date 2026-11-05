# Grocery POS

A point-of-sale and inventory system for a grocery store, as a pnpm workspace.

| Package                  | Path                 | What it is                                                                                         |
| ------------------------ | -------------------- | -------------------------------------------------------------------------------------------------- |
| `grocery-pos-api`        | `apps/api`           | NestJS 11 + Mongoose 8 REST API (MongoDB)                                                          |
| `grocery-pos-client`     | `apps/client`        | Vue 3 + Vite + Tailwind 4 SPA                                                                      |
| `@grocery-pos/contracts` | `packages/contracts` | Shared by both: roles, limits, enums, error codes, money math and the wire types of every response |

`packages/contracts` is the single source of truth for anything both sides must
agree on. If you add a role, change a field limit, add an error code, or change
what a route returns, change it there — not in one app.

Each response body has a wire type in contracts (`src/wire/`, plus the shift
views in `shift.ts` and `AppErrorResponse`/`Paginated` in `errors.ts`), typed
as the JSON sent: ids and timestamps are strings, money is integer centavos.
The client reads responses through them (`api.get<Paginated<SaleRow>>(…)`);
the API's controllers declare them as return types (`asJson`), and the
real-database suite checks real responses against their `*_SHAPE` key lists.
The build emits CommonJS and ES modules; relative imports in `src` end in
`.js` so plain Node can load the ESM build (the build fails otherwise).

## Setup

Requires Node `^20.19.0 || >=22.12.0` (the `engines` range; CI and the
Docker images use Node 22) and pnpm 10.

```bash
pnpm install

cp apps/api/.env.example apps/api/.env
cp apps/client/.env.example apps/client/.env
```

Inspect both `.env` files for values you need to set.

`JWT_SECRET` and `COOKIE_SECRET` must be at least 32 characters. The
placeholders in `.env.example` work in dev (`APP_ENV=dev`) but are rejected at
startup in `prod`/`stage`, as is using the same value for both. Generate a
distinct value for each deployed secret with:

```bash
openssl rand -base64 48
```

### Login hero photo

The login page's photo is served from
`apps/client/public/images/login-hero.jpg` and is not in the repo (no binaries,
and no third-party hosts at runtime). Fetch it once per checkout:

```bash
curl -L --create-dirs -o apps/client/public/images/login-hero.jpg "https://images.unsplash.com/photo-1542838132-92c53300491e?w=1600&q=70&fm=jpg"
```

The photo is from Unsplash, under the
[Unsplash License](https://unsplash.com/license) (free to use, no attribution
required). Without the file the page shows its dark teal gradient instead, and
the build still passes. The client Docker build fetches it itself, best
effort ([docs/DEPLOY.md](docs/DEPLOY.md#login-photo)).

## Database

```bash
docker compose up -d      # MongoDB 7 as a single-node replica set (needed for transactions)
pnpm seed                 # sample users, products, inventory, restocks, adjustments
```

Run both from the repo root, where `docker-compose.yml` lives. It is for
development only: MongoDB runs without authentication, bound to `127.0.0.1`.

## Run

```bash
pnpm dev                  # API on :3000, client on :5173
```

Or individually:

```bash
pnpm --filter grocery-pos-api dev
pnpm --filter grocery-pos-client dev
```

Seeded users are named after their role (`ADMIN`, `SELLER`, `RESTOCKER`,
`ADJUSTER`, `USER_MANAGER`), all with the password `password123`, plus an
inactive copy of each (`ADMIN1`, `SELLER1`, ...). Development only.
Each holds only its own role, so ring up sales as `SELLER`: an admin
account also needs the Seller role to sell (#84).

`pnpm seed` drops every collection of the database in `DATABASE_URL` and
prints which host and database that is first. It runs freely only when
`APP_ENV` is `dev` or `test`; anything else (including `prod`, `stage` or
unset) needs `--force-destroy-data` (`pnpm seed --force-destroy-data`).

## Deployment

[docs/DEPLOY.md](docs/DEPLOY.md) covers Railway: the custom domain both
services need (Railway's own domains cannot share the session cookies), every
variable of each service, which client variables are build arguments, `APP_ENV`
versus `NODE_ENV` (and the client's `VITE_APP_ENV`), the security headers,
healthchecks and running the images locally.

## Deploy notes (operator)

The client Docker build fetches the login photo itself, best effort (see
[Login hero photo](#login-hero-photo)).

The client's stage variable is now `VITE_APP_ENV` (#86). Set it on each
client service before or with this deploy; the old `VITE_NODE_ENV` is still
accepted for one release (see
[docs/DEPLOY.md](docs/DEPLOY.md#vite_app_env-and-vite_node_env)). Rename it in
a local `apps/client/.env` too.

One-off steps to run by hand at a specific deploy. Each runs from a checkout
of the deployed commit (with `pnpm install` and the contracts built), pointed
at the target database through `DATABASE_URL`, e.g.
`DATABASE_URL='mongodb+srv://…' pnpm migrate:decode-entities`.

### Drop the old single-field sales shift index (#16), once

#16 adds the Sales indexes `createdAt_-1`, `cashier_1_createdAt_-1` and
`shift_1_createdAt_-1`, and the Inventory index `stock_1`. The API builds them
on its first startup after the deploy. `shift_1_createdAt_-1` replaces the
single-field `shift_1`, which the schema no longer declares, but Mongoose never
drops an index. Once `shift_1_createdAt_-1` exists (check with
`db.sales.getIndexes()`), drop the old one in `mongosh`:

```js
db.sales.dropIndex('shift_1');
```

Before the new index exists, `shift_1` is still what closing a shift reads
sales through, so don't drop it earlier.

### Decode HTML entities in stored text (#15), once

Before #15 the API stored request text HTML-encoded: `M&M's` became
`M&amp;M's`, and receipts, reports and the product list showed it literally.
The fix stores text as typed; this migration decodes what is already stored
(`&amp;`, `&lt;`, `&gt;`, `&quot;`) in product and user names, restock and
adjustment descriptions, adjustment reasons, sale discount and void/refund
reasons, and shift cashier names, drawer-movement reasons and Z-read names.

```bash
pnpm migrate:decode-entities            # dry run: prints what would change
pnpm migrate:decode-entities --apply    # writes it
pnpm migrate:decode-entities --apply --resume-stale   # after a crashed run
```

Run it with the API stopped, and keep the API stopped until the migration
has ended `complete`, including any reruns after an `incomplete` or crashed
run. Text typed after the fix is stored raw, and a literal `&amp;` in it must
not be decoded, but a rerun plans every document it has no record of; with
the API stopped nobody can type such text, or re-create a name, in between:

1. Back up the database (or rehearse on a restored copy first).
2. Stop the API.
3. Deploy the fix, without starting the API yet.
4. Run the dry run. It lists, per collection and field, how many documents
   would change, with examples, and every `SKIPPED` document: a product or
   user whose decoded name would duplicate an existing one (both names are
   unique).
5. Run with `--apply`. If it exits with status 1, fix the cause and run
   `--apply` again (see below) until it ends `complete`.
6. Start the API.

A `SKIPPED` product or user keeps its encoded name until someone renames it.
A skipped user must type the name encoded to sign in (e.g. `m&amp;m`, not
`m&m`) until an admin renames the account; rename one of each pair in the
app once the API is back.

Only one `--apply` can run at a time. It first claims the marker in the
`migrations` collection (status `running`, with its run id, `host:pid` and
start time); a second `--apply` meanwhile refuses with status 1 and names
the holder. A dry run next to it only warns. If an `--apply` crashed or was
killed, its marker stays `running` and the next `--apply` refuses; once you
are sure that process is gone, rerun with `--apply --resume-stale` to take
the lock over. Never use `--resume-stale` while another run may be alive:
two runs at once can decode a document twice.

The run is crash-safe and resumable. It records each document's exact
edit in `migration_progress` before touching it. Each write only applies if
the document still holds the value that was read, so a document edited
meanwhile is reported and skipped, not overwritten. A product or user name
that is taken is retried after the other renames land, so a name freed in the
same run (`&amp;lt;x` waiting for the `&lt;x` that becomes `<x`) still
decodes; only real duplicates are skipped. If a write fails, the
run carries on, exits with status 1 and ends `incomplete`: fix the cause and
run `--apply` again. The rerun (like a rerun after a crash) retries only the
documents that were not written and never decodes one twice. Once a run ends
`complete`, further `--apply` runs are refused, because decoding text typed
after the fix would corrupt it.

The old pipe decoded its input before re-encoding it, so an entity a user
typed literally was already lost on the way in: a typed `&lt;` was stored as
`&lt;`, exactly like a typed `<`, and the migration turns it into `<`. That
cannot be undone. Everything else decodes back to what was typed. Passwords
are not affected: login passwords were never encoded, and hashes cannot be
migrated. A password changed through "change password" before #15 that
contained `&`, `<`, `>` or leading/trailing spaces was hashed in its encoded,
trimmed form; that user signs in with the encoded form or gets an admin
reset.

## Measured products (#36)

Create products with unit `PIECE` (default), `KG`, `G`, or `L`. Price and
restock unit cost are centavos per selected unit. The register, restock and
adjustment forms accept whole pieces/grams or up to three decimals for kg/L.
For example, `0.450 kg × ₱180.00/kg` costs `₱81.00`.

Quantities and stock are **integer minor units throughout the API and DB**:
`PIECE` = pieces, `KG`/`G` = grams, `L` = millilitres. A `KG` product's request
`quantity: 450` means 0.450 kg, not 450 kg. Prices remain per displayed unit;
line totals round half up once to integer centavos. The shared quantity helpers
perform exact conversions and BigInt arithmetic. API requests reject fractional
minor units and unsafe integer values.

Existing products, stock, receipts and saved baskets without a unit remain
pieces. No quantity migration is required. A product's unit is fixed on creation;
changing it would reinterpret stock and historical quantities, so create a separate
product for a different measure. New sale/restock details snapshot the unit, and
receipts include their unit and per-unit price. Approval fingerprints include the
measure; parked tickets keep it and refuse to resume with an incompatible measure.
Low-stock and maximum-stock filters compare displayed units (10 kg = 10,000 g).

Pack measures and embedded price/weight scale-label barcodes are deferred. The
store's generated `200…` codes continue to follow the existing barcode rules.

## Passwords

Passwords must be at least 8 characters when set (new users, admin resets,
self-service changes). Login does not check the length, so older, shorter
passwords still work until they are changed.

## Manager approvals

Every nonzero sale discount requires an admin's approval. Voids and refunds
require an admin or supervisor's approval; cashiers may reverse only their own
sales in their current open shift. An admin retains access to other sales and
existing payout-shift selection.

An admin sets a manager's six-digit PIN from **Users → Manager PIN**. Only
ADMIN or SUPERVISOR accounts can hold a PIN; SUPERVISOR grants approval
capability without other app access. Add another role if that account also
needs to use the app. No default PIN is seeded. Set an admin PIN before the
first discounted checkout or reversal after deploying this change.

At the cashier terminal, the manager enters their username and PIN without
logging the cashier out. Each approval expires after 60 seconds and can approve
only the action shown. Changing the ticket, prices, reversal reason or payout
drawer requires approval again. A checkout retry of an already recorded sale
remains safe and needs no new approval. Unsold ticket edits remain ordinary
register actions; partial refunds and the sensitive-action audit-log screen
remain future work.

## Parked tickets

At the register, **Park Ticket** saves the current basket with an optional note
and clears it for the next customer. **Parked (n)** lists your drafts in this
browser. Park or clear any active basket before resuming another ticket.
Resuming refreshes every product and price from the server; if any product is
unavailable or the refreshed basket exceeds the sale limit, the parked draft
is kept intact. Stock is checked and deducted only at checkout. Discounts still
need fresh admin approval at checkout.

Parked drafts survive a reload and remain private to the original cashier after
logout. They do not move between browsers or terminals. Ending a shift with
parked tickets requires choosing **Move to my next shift** or **Discard**; the
choice applies only after the shift closes successfully. At most 50 tickets
can be parked. A storage failure leaves the original ticket intact. A ticket
with an unresolved checkout attempt must be retried before it can be parked,
so a lost sale response cannot become a second sale through parking.

## Offline cash sales

Open a shift online and wait for **Offline cash ready** before disconnecting.
The browser prepares a server-signed product catalogue and a cashier/session/
shift lease; KG/G/L prices retain their displayed-unit meaning. Install the
app from the browser menu if desired, or use the ordinary browser tab. HTTPS
(or localhost) is required for the offline shell. Catalogue refresh runs every
30 seconds while connected; changing the app does not force-reload an active
checkout.

When disconnected, catalogued items can be scanned/searched and sold for
**cash only**, at the cached verified price. Discounts, GCash, overrides,
voids and refunds require reconnection. The local receipt says it is pending
sync. The IndexedDB outbox survives reload and logout, and automatically
uploads each receipt using its original idempotency key when connectivity
returns. A sale whose online response was lost must be retried online first;
it cannot be converted into another offline charge.

Keep the terminal/browser data until pending sales are zero. Queueing must
finish durably before the basket clears; storage failures refuse checkout.
The browser is asked for persistent storage, but clearing site data removes
its local outbox. A different cashier does not inherit queued sales. The
cached authorization ends with the original login session, so reconnect and
log in again before it expires.

Normal shift close first syncs collected cash and releases offline mode on
every terminal. A closed/force-closed shift or revoked cashier/session leaves
sales pending for **admin reconciliation**. An admin logs in on the same
terminal, opens **Review pending sales**, enters a reason and records the
collected cash. Original Z-read totals remain unchanged; late cash appears as
a separate addendum when that report is read again. Original sale time is
stored as `soldAt`, separately from the server's `createdAt` ingestion time.

Already-collected offline sales are recorded even if stock is now short.
Negative stock remains visible in Inventory, and Sales Details flags the
shortfall for an admin to reconcile. Normal online checkout still refuses
overselling. Server price proofs and bounded upload validation prevent using
this path to invent prices or arbitrary product units.

## Categories (#39)

Admins manage categories under **Categories**: names are unique without regard to
case, sort order controls their presentation, and archive/restore controls new
assignments. RESTOCKER/ADJUSTER can read the list for product forms and filters;
only ADMIN can change categories. Product category remains optional. Selling-price
changes remain ADMIN-only, and product units cannot be changed.

Archiving a category does not archive its products or prevent their sale. Existing
assignments remain visible and can be retained when editing another product field.
New assignments require an active category. A category referenced by **any** product,
including an archived product, cannot be deleted: archive it instead. This preserves
history and avoids dangling references. An unreferenced category may be deleted.

### Migrate legacy category enum values before deploying

The new product category is an ObjectId reference instead of an enum string.
Back up the database, stop the API, and keep it stopped while applying the
migration and deploying the matching API/client. Build contracts first. Point
`DATABASE_URL` at the intended database explicitly:

```bash
pnpm migrate:categories           # dry run; lists product counts per old label
pnpm migrate:categories --apply   # one atomic transaction; requires replica set
```

The migration upserts FOOD, DRINKS, ELECTRONICS, HOUSEHOLD and CLOTHES by their
case-insensitive name keys and replaces matching product strings with the category
ids. Existing matching categories are reused without changing names or status.
Uncategorized products and current references are untouched. Unknown legacy
strings cause refusal before any write: resolve them and rerun. Category-name key
collisions fail instead of overwriting a category. The transaction rolls back on
failure or interruption; `--apply` can safely rerun and retains the same references.
Verify that no legacy string categories remain before starting the API. Do not
run the old and new API together against this database. `pnpm seed` creates the
same category documents and ObjectId references for development.

Category data does not change signed offline price/unit proofs or completed cash
receipts; pending offline receipts still sync/reconcile. Category reporting will
use these references in #44.

## Suppliers and cost basis (#41)

Manage suppliers from **Suppliers** as an admin or restocker. Every new restock
requires an active supplier; an invoice/DR number is optional. Historical receipts
without supplier data remain intact. Suppliers referenced by receipts can be
archived, not deleted. Deploy the matching API and client before entering new
receipts, since older clients do not send the required supplier.

Receiving updates the product's latest receipt cost in the same transaction as
stock and receipt details. Costs remain centavos per displayed unit (for example
per kg); each sale captures that basis. Product-list/editor margin estimates are
admin-only and based on the latest receipt, not FIFO or weighted average. Unknown
cost remains unknown and historical margins are not invented. Only an explicit
zero-cost receipt means free stock. Report coverage for unknown-cost sales is #44.

Restock drafts created from low stock load procurement-cost defaults, preserve
user edits, and still require review of actual receipt costs. Unknown costs keep
the existing zero-cost confirmation. Never use selling price as purchase cost.

Queued offline sales reference confidential server-side cost evidence captured
with their catalogue. Customer/cashier caches do not carry readable cost values.
Later sync uses that basis even if another receipt changed current cost; old
proofs without cost evidence stay unknown. Cost evidence must not be removed
while corresponding queued receipts could still be reconciled.

Purchase orders are a separate owner-approved follow-up: #123. No user database
migration or historical cost/supplier backfill is required by this first phase.

## Sales reports and CSV (#44)

ADMIN accounts can open **Sales Reports** and **Sales History** without a
SELLER role. Reports group by store calendar day, product, managed category,
cashier or payment type; SPLIT stays its own payment-type group. Presets use
`GET /reports/options`'s store timezone and calendar date, not the device zone.
Weeks start Monday. Custom date ranges include both dates and may contain at
most 366 days.

Reports use **event dates**: a sale is recorded at original `soldAt` (or legacy
`createdAt`), and a later void/refund affects `reversal.at`, with original price,
discount and cost snapshots. Prior sale periods are not restated. The existing
dashboard retains original-sale-day totals excluding currently reversed sales;
its explanatory note distinguishes this from event-date reports.

Gross sales are before discounts; charged sales are gross less discounts; net
sales subtract reversal events. Product/category discounts are allocated in
integer centavos by largest remainder before filtering. Quantities are separate
per measure, never a sum of pieces and kilograms. A transaction touching multiple
product/category groups counts in each such group, but totals count it once.
Category groups use current product assignments, including archived categories.

Known COGS/margins use the latest-receipt basis, an estimate rather than FIFO or
weighted average. Explicit zero is known; missing historical/offline cost remains
unknown. Complete gross margin is absent when coverage is incomplete; the report
instead labels its known-cost portion and unknown event-line count. Costs never
reach cashier receipts through these endpoints, which are ADMIN-only.

Original Z-reads remain immutable closing snapshots. The reconciliation panel
shows original charges, reversal events, reversals of prior-period sales, and
late offline occurrences, with a link to original shift reports and addenda.
Calendar-period net must not be compared to an unadjusted closing snapshot or
its drawer total without reconciling those dates and payout movements.

`GET /reports/sales` and `/reports/sales.csv` accept `from`, `to`, `groupBy`, and
optional `cashier`, `paymentType`, `category`. Indexed date matching precedes
lookups; source rows are reduced through a cursor with bounded group memory.
More than 10,000 groups is rejected, never silently truncated. CSV streams the
same filters, starts with a UTF-8 BOM, uses ISO calendar-day keys and exact plain
peso decimals, leaves unknown complete-margin cells empty, and neutralizes
spreadsheet formulas in user text.

Sales history uses `dateFrom`/`dateTo`, `cashier`, `paymentType`, `category` and
`saleNumber` filters. The latter accepts a full 24-hex ID or final 8-hex receipt
number; suffix collisions return all scoped matches. Seller history still only
sees that cashier's current open shift. History displays both short and full IDs.

## Sensitive-action audit log

Admins can open **Audit Log** to filter events by actor ID, action and store-calendar
dates, and inspect the allowed before/after changes. Users, prices, manager-approved
discounts/reversals, shifts/drawer movements and credential logins are recorded
from this deployment onward. Existing history is not fabricated or backfilled.

No automatic retention expiry is configured yet. The app exposes no audit editing,
deletion or archive action. Guards protect writes through application models;
privileged database administrators remain able to operate on the database directly.
Passwords, PINs, hashes and session credentials are never audit diff fields.
Failed logins retain generic client responses; only handled credential attempts
are recorded, with bounded attempted names and request metadata.

## Checks

Build the contracts first: their `dist` is gitignored, and the apps resolve
`@grocery-pos/contracts` through it.

```bash
pnpm --filter @grocery-pos/contracts build
pnpm format:check
pnpm lint                 # --max-warnings 0 in every package
pnpm typecheck
pnpm test                 # with coverage thresholds (see below)
pnpm build                # the client needs the VITE_* variables, as in CI
```

`pnpm test` runs every package's tests with coverage: jest in `apps/api`
(`coverageThreshold` in its `package.json`), vitest in `apps/client` and
`packages/contracts` (`thresholds` in each `vitest.config.ts`). The
thresholds sit just below the measured coverage; raise them as coverage
grows, never lower them to get a change through. To run a few tests without
the threshold, call the runner directly (`pnpm --filter grocery-pos-api exec
jest src/sales`, `pnpm --filter grocery-pos-client exec vitest run src/stores`).

`git push` runs a pre-push hook (`.husky/pre-push`): the contracts build,
lint and typecheck. Tests and the build run in CI.

### Real-database tests

`pnpm test` mocks the Mongoose models, so it cannot show what only MongoDB
enforces: the unique partial indexes, transactions under concurrency and
rollback. `apps/api/test/db/*.db-spec.ts` boots the real `AppModule`
against a MongoDB replica set and checks them (duplicate GCash references
and idempotency keys, concurrent same-key checkouts, concurrent
voids/refunds, a reversal rolled back mid-transaction, one open shift per
cashier, concurrent first sales on an empty database), and that real
responses have exactly the keys of their contracts wire types
(`wire.db-spec.ts`). It is a separate
jest config (`apps/api/jest.db.config.ts`), not part of `pnpm test` or its
coverage, so the checks above still pass without Docker.

Against the docker compose MongoDB:

```bash
docker compose up -d
pnpm --filter @grocery-pos/contracts build
MONGO_URI_TEST="mongodb://127.0.0.1:27017/?directConnection=true" \
  pnpm --filter grocery-pos-api test:db
```

Each spec file creates its own `gpos_dbtest_*` database and drops it
afterwards; nothing else on the server is touched. Without
`MONGO_URI_TEST`, or when it is not a replica set, the run fails up front
instead of skipping. CI runs it in the `db` job.

### CI

`.github/workflows/ci.yml` runs on pull requests and on pushes to `develop`,
`staging`, `production` and `master`. It installs with `--frozen-lockfile`,
builds the contracts, then runs `format:check`, `pnpm audit --audit-level
high`, depcheck, the license check (`pnpm licenses:check`, which fails on
any GPL or AGPL license anywhere in the workspace, but not LGPL), lint, typecheck,
test and build. The `db` job starts MongoDB 7 as a single-node replica set
(the repo's `mongo-init.sh`, as docker compose does) and runs `test:db`. A
newer push to the same PR cancels its older run; branch pushes never cancel
each other.

- The audit only fails the run when the change touches `pnpm-lock.yaml` or a
  `package.json`; otherwise a new advisory is reported without failing.
  `.github/workflows/audit.yml` runs the audit weekly (and on demand from
  the Actions tab) and fails on any high advisory.
- When a Docker-related file changes (either Dockerfile, `.dockerignore`,
  `apps/client/nginx.conf.template`, `apps/client/docker-entrypoint.sh`,
  either `railway.json`, any `package.json`, `pnpm-workspace.yaml` or
  `pnpm-lock.yaml`), a separate job builds both
  images, without pushing them, and smoke-tests the client image (non-root,
  security headers, `/health`).

Railway rebuilds a service only when its `build.watchPatterns` match: the
app's own folder, `packages/contracts`, the lockfile, the root
`package.json`, `pnpm-workspace.yaml` and `.dockerignore`.

## Product editing and archival

Products has Edit and Archive/Restore controls for restockers and admins, with
active/archived/all filtering. Selling price edits are admin-only. Prices remain
integer centavos and actual changes retain private actor/time/old/new history.
A product's unit cannot be changed after creation.

Archiving stops fresh online sales and register lookups without deleting stock or
historical records. The next offline catalogue sync removes archived products
from cached availability; cash already collected offline remains recoverable.
Reorder levels are editable in the same dialog (#40); audit-log presentation remains #46.

## Reorder planning (#40)

Use **Products → Edit** to set each product's reorder level and restock quantity.
Both are entered in the product's unit; KG/L allow three decimals. Products
without settings default to ten displayed units. Restockers and admins can edit
these settings; selling-price changes remain admin-only.

**Inventory → Low stock** includes active products at or below their own level,
including zero and recorded negative stock. The dashboard low-stock tile links to
that list for inventory roles, and the sidebar shows its count. Out-of-stock
counts may overlap. Largest displayed-unit shortages appear first.

**Restock listed items** opens an unsaved restock draft for the current page, using
each configured restock quantity. Review quantities and enter actual unit costs
before saving. No stock changes until the normal confirmed restock is submitted.
A zero unit cost still requires the existing explicit confirmation. Handoff never
transfers drafts to another user or writes stock automatically.

## Expiry tracking and batches

Choose **Track expiry and batches** when creating a perishable product, or in its
editor after stock reaches zero. Once any batch history exists, tracking stays
enabled: switching it off could make a later expired return sellable. Existing products stay untracked; no opening expiry is invented.

Every tracked restock line needs an expiry date and can include a batch number.
The register uses earliest unexpired lots first. The expiry date remains usable
through that store calendar day, and expired stock is blocked from online sales.
Measured quantities keep their usual integer gram/millilitre precision.

Open Inventory → Expiry and batches to review lots, expiry days and reconciliation
balances. **Write off** creates a batch-specific unsaved adjustment for review; it
never changes stock until that adjustment is saved. Returns restore their original
lots, so an expired return does not become sellable again.

Tracked products require an online register. They are removed from new offline
catalogues. Previously collected cash is retained and requires an ADMIN to
reconcile it; explicit deficit lots keep stock totals accountable without inventing
expiry dates. Undated reconciliation lots cannot be sold. Review and reconcile those balances through batch-specific adjustments. Cost/margin continues to use the latest-receipt basis,
not batch valuation.

## Physical stock counts (#43)

ADJUSTER and ADMIN can open **Stock Counts**, choose all active products, a category,
or picked barcodes, and save partial counts on the server to resume later. Blank
is not counted; enter zero explicitly for an empty shelf. KG/L quantities use the
usual three decimal places, and expiry-tracked products are counted per batch.

The opening timestamp and expected quantities are the reference. Align physical
counting with that reference (prefer a quiet counting period): approval posts the
fixed variance `counted - opening expected` to current stock, preserving sales,
receipts, refunds and adjustments made since opening. If the physical count
already includes those later movements, use a fresh reference; the system cannot
infer when an individual shelf was counted. Submitted review shows current and
projected balances. Negative results are refused atomically; review/cancel and
start a new count if intervening changes make a variance invalid.

An ADMIN or SUPERVISOR enters their manager username and PIN at the counter's
screen to approve submitted quantities. One transaction posts one adjustment with
nonzero variances and records the manager; retries do not post twice. A zero-change
count records approval without creating an empty adjustment. Cancelled counts
remain in history. At most 200 lines can be counted together (including batch
lines); choose a smaller scope for larger inventories. Counts do not create new
expiry batches, and tracking/unit changes require a new count.

### Backfill the stock movement ledger before deploying #45

Stop every API instance and background stock writer before this migration and keep
all writers stopped until it completes. Back up the database first. From the new
checkout, install dependencies and build contracts, then point `DATABASE_URL` at
that database (a replica set is required):

```bash
pnpm migrate:stock-ledger           # read-only preview; creates no marker or index
pnpm migrate:stock-ledger --apply   # atomic per product; resumable, globally locked
```

The backfill reconstructs known receipts, adjustments, approved counts, original
sales and reversal events. It adds an explicitly unattributed OPENING movement for
`current stock - known net movements`; unknown actors stay unknown. Historical
running balances are derived estimates. Posting sequence and posting-day filters
remain separate from original occurrence time, including delayed offline sales.
There is no invented cost or financial history.

If apply fails, keep the API stopped, resolve the reported data problem and rerun
`--apply`: unchanged completed products retain their original ledger IDs. A process
crash can leave a running lock; only after proving the previous process is gone,
use `pnpm migrate:stock-ledger --apply --resume-stale`. Changed source history or
existing live ledger rows are refused rather than overwritten. Startup refuses an
incomplete migration. Do not start the new API first: live writes establish opening
balances and make historical backfill refuse that product. The history's integrity
check reports discrepancies and never repairs stock automatically.

### Store settings

Administrators manage store name, branch, address, contact number, optional TIN,
receipt footer, timezone and the default reorder level at **Settings**. Other
logged-in users read the saved presentation settings. Changes use an optimistic
version and share a transaction with their sensitive-action audit entry; reload
before retrying a conflicting edit.

Currency remains **PHP**. Every nonzero discount still requires ADMIN PIN
approval. The reorder default is whole displayed units and applies only to new
products without an explicit level; it does not change existing or legacy levels.

The settings singleton initializes its timezone from `STORE_TIMEZONE` on first
startup. Subsequent API calendar boundaries read the committed database value.
Close all shifts and release every active offline terminal lease before changing
timezone. Existing closed Z-reads and new receipt identity snapshots keep their
original identity/timezone; legacy receipts without snapshots show the current
last-known identity. Offline leases retain their server-issued identity snapshot
for delayed uploads. Receipt printing and BIR compliance remain deferred to #48.

The terminal/lane label is stored on the device and used for its next shift. It
has no authorization significance. Clients retain validated last-known store
presentation settings for offline display, refresh them when online, and clear
the active presentation when the session changes. API responses are not cached
by the service worker.
