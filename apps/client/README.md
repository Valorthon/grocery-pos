# Grocery POS Client

Vue 3 + Vite + Tailwind 4. Setup, checks and deployment are in the
[root README](../../README.md) and [docs/DEPLOY.md](../../docs/DEPLOY.md);
the commands below run from the **repo root**.

## Setup

```bash
pnpm install
pnpm --filter @grocery-pos/contracts build
cp apps/client/.env.example apps/client/.env
```

`vite.config.ts` validates the `VITE_*` variables
(`src/config/validation.env.ts`) and refuses to start the dev server or the
build when one is missing or malformed; the console shows which. The
`VITE_*` values are inlined into the bundle at build time.

## Run

```bash
pnpm --filter grocery-pos-client dev
```

Runs the app with hot reload on `http://localhost:5173`.

## Test

```bash
pnpm --filter grocery-pos-client test   # vitest in jsdom, with coverage thresholds
```
