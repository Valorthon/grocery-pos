# Grocery POS

A point-of-sale and inventory system for a grocery store, as a pnpm workspace.

| Package                  | Path                 | What it is                                                         |
| ------------------------ | -------------------- | ------------------------------------------------------------------ |
| `grocery-pos-api`        | `apps/api`           | NestJS 11 + Mongoose 8 REST API (MongoDB)                          |
| `grocery-pos-client`     | `apps/client`        | Vue 3 + Vite + Tailwind 4 SPA                                      |
| `@grocery-pos/contracts` | `packages/contracts` | Types shared by both: roles, validation limits, enums, error codes |

`packages/contracts` is the single source of truth for anything both sides must
agree on. If you add a role, change a field limit, or add an error code, change
it there — not in one app.

## Setup

Requires Node `>=22.12` and pnpm 10.

```bash
pnpm install

cp apps/api/.env.example apps/api/.env
cp apps/client/.env.example apps/client/.env
```

Inspect both `.env` files for values you need to set.

`JWT_SECRET` and `COOKIE_SECRET` must be at least 32 characters. The
placeholders in `.env.example` work in dev (`NODE_ENV=dev`) but are rejected at
startup in `prod`/`stage`, as is using the same value for both. Generate a
distinct value for each deployed secret with:

```bash
openssl rand -base64 48
```

### Login hero photo

The login page's photo is served from
`apps/client/public/images/login-hero.jpg` and is not in the repo (no binaries,
and no third-party hosts at runtime). Fetch it once per checkout, and on every
deploy build:

```bash
curl -L --create-dirs -o apps/client/public/images/login-hero.jpg "https://images.unsplash.com/photo-1542838132-92c53300491e?w=1600&q=70&fm=jpg"
```

The photo is from Unsplash, under the
[Unsplash License](https://unsplash.com/license) (free to use, no attribution
required). Without the file the page shows its dark teal gradient instead, and
the build still passes.

## Database

```bash
docker compose up -d      # MongoDB 7 as a single-node replica set (needed for transactions)
pnpm seed                 # sample users, products, inventory, restocks, adjustments
```

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

`pnpm seed` drops every collection of the database in `DATABASE_URL` and
prints which host and database that is first. It runs freely only when
`NODE_ENV` is `dev` or `test`; anything else (including `prod`, `stage` or
unset) needs `--force-destroy-data` (`pnpm seed --force-destroy-data`).

## Deploy notes (operator)

Every client build: fetch the login photo first (see
[Login hero photo](#login-hero-photo)).

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

## Passwords

Passwords must be at least 8 characters when set (new users, admin resets,
self-service changes). Login does not check the length, so older, shorter
passwords still work until they are changed.

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

CI runs all four, plus `pnpm audit`, depcheck, and a license check.
