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
`ADJUSTER`, `USER_MANAGER`), all with the password `a`. Development only.

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

CI runs all four, plus `pnpm audit`, depcheck, and a license check.
