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

One-off steps to run by hand at a specific deploy. Each runs from a checkout
of the deployed commit (with `pnpm install` and the contracts built), pointed
at the target database through `DATABASE_URL`, e.g.
`DATABASE_URL='mongodb+srv://…' pnpm migrate:decode-entities`.

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
```

1. Back up the database (or run it against a restored copy first).
2. Run the dry run. It lists, per collection and field, how many documents
   would change, with examples, and every `SKIPPED` document: a product or
   user whose decoded name would duplicate an existing one (both names are
   unique). Rename one of each pair in the app, or accept that the skipped
   one keeps its encoded name.
3. Deploy the fix, then run with `--apply` right away, before users re-enter
   names by hand. Each write only applies if the document still holds the
   value that was read, so a document edited in between is reported and
   skipped, not overwritten; no single failure stops the run.
4. It records itself in the `migrations` collection and refuses a second
   `--apply`, because decoding twice would turn a typed `&lt;` into `<`.

Text a user typed as a literal entity was stored double-encoded
(`&amp;lt;`) and decodes back to exactly what they typed (`&lt;`). Passwords
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
