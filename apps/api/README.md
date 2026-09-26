# Grocery POS API

NestJS 11 + Mongoose 8. Setup, checks and deployment are in the
[root README](../../README.md) and [docs/DEPLOY.md](../../docs/DEPLOY.md);
the commands below run from the **repo root**.

## Setup

```bash
pnpm install
pnpm --filter @grocery-pos/contracts build
cp apps/api/.env.example apps/api/.env
```

Inspect `apps/api/.env` for values you must set. `APP_ENV` is the deployment
stage (`dev`, `test`, `stage`, `prod`); leave `NODE_ENV` to Node.

`JWT_SECRET` and `COOKIE_SECRET` must be at least 32 characters. The
placeholders in `.env.example` work in dev (`APP_ENV=dev`) but are rejected at
startup in `prod`/`stage`, as is using the same value for both. Generate a
distinct value for each deployed secret with:

```bash
openssl rand -base64 48
```

## Database

```bash
docker compose up -d      # repo root: MongoDB 7 replica set, dev only, no auth
pnpm seed                 # drops and refills the DATABASE_URL database
```

## Run

```bash
pnpm --filter grocery-pos-api dev
```

Runs the API in watch mode on `http://localhost:3000` (routes under `/v1`).

## Test

```bash
pnpm --filter grocery-pos-api test      # jest, with coverage thresholds
MONGO_URI_TEST="mongodb://127.0.0.1:27017/?directConnection=true" \
  pnpm --filter grocery-pos-api test:db  # real-MongoDB suite
```
