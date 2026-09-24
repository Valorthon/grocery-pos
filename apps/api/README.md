# Grocery POS API

## Setup

```bash
pnpm install
```

Installs all project dependencies.

## Setup Env

```bash
cp .env.example .env
```

Copies the .env.example file to create a .env file

_Note: Inspect the .env file if there are variables you must set_

`JWT_SECRET` and `COOKIE_SECRET` must be at least 32 characters. The
placeholders in `.env.example` work in dev (`NODE_ENV=dev`) but are rejected at
startup in `prod`/`stage`, as is using the same value for both. Generate a
distinct value for each deployed secret with:

```bash
openssl rand -base64 48
```

## Database Initialization

```bash
docker compose up -d
pnpm run seed
```

Starts the MongoDB database in Docker, and seeds it with sample users, products, inventory, restocks, and adjustments.

## Run the App

```bash
pnpm run start:dev
```

Runs the API in watch mode with live reloading.

The API runs on `http://localhost:3000`.
