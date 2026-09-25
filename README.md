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

Run it with the API stopped, so nobody types new text while it runs (text
typed after the fix is stored raw, and a literal `&amp;` in it must not be
decoded) and nobody re-creates a name in between:

1. Back up the database (or rehearse on a restored copy first).
2. Stop the API.
3. Deploy the fix, without starting the API yet.
4. Run the dry run. It lists, per collection and field, how many documents
   would change, with examples, and every `SKIPPED` document: a product or
   user whose decoded name would duplicate an existing one (both names are
   unique).
5. Run with `--apply`.
6. Start the API.

A `SKIPPED` product or user keeps its encoded name until someone renames it.
A skipped user must type the name encoded to sign in (e.g. `m&amp;m`, not
`m&m`) until an admin renames the account; rename one of each pair in the
app once the API is back.

The run is crash-safe and resumable. It marks itself `running` in the
`migrations` collection before writing, and records each document's exact
edit in `migration_progress` before touching it. Each write only applies if
the document still holds the value that was read, so a document edited
meanwhile is reported and skipped, not overwritten. If a write fails, the
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
