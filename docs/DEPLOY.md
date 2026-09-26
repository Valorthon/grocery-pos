# Deploying Grocery POS

Production and staging run on [Railway](https://railway.com) as two services
built from this repo's Dockerfiles: the API (`apps/api`) and the client
(`apps/client`, static files served by nginx). MongoDB is a separate replica
set (Atlas or similar; transactions need a replica set).

## Prerequisite: a custom domain with a shared parent

**The client and the API must be served from one registrable domain**, for
example `pos.example.com` (client) and `api.example.com` (API). Railway's
default `*.up.railway.app` domains do not work, and no setting fixes that.

Why: `up.railway.app` is on the [Public Suffix List](https://publicsuffix.org),
so `a.up.railway.app` and `b.up.railway.app` are different sites to the
browser, like two unrelated domains. Sign-in depends on sharing cookies
between the two services:

- the API sets its cookies for `DOMAIN` (the shared parent, e.g.
  `example.com`) with `SameSite=Lax`, which the browser only sends on
  same-site requests;
- the client reads the `dummy` session marker through `document.cookie`,
  which only works when that cookie belongs to the client's domain too.

A browser refuses a cookie `Domain` that is a public suffix, and prod/stage
validation requires `DOMAIN`, so on Railway's domains login cannot work.

Set it up per environment:

1. Add the custom domains in each Railway service (Settings, Networking) and
   create the DNS records Railway shows.
2. Use them in the variables below: `FRONTEND_URL`, `DOMAIN`, `VITE_API_URL`,
   `VITE_DOMAIN`.

## Services and variables

Each service's `railway.json` (`apps/api/railway.json`,
`apps/client/railway.json`) selects its Dockerfile, the paths that trigger a
rebuild (`build.watchPatterns`) and the healthcheck. Point each Railway
service at its file (Settings, Config-as-code) and keep the service's root
directory at the repo root, because both images need `packages/contracts`.

### API service

Runtime variables, validated at startup (`apps/api/src/common/typed-config`);
the API refuses to start when one is wrong. `apps/api/.env.example` describes
each.

| Variable                                            | Value                                                                                                           |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `APP_ENV`                                           | `prod` or `stage` (see [APP_ENV and NODE_ENV](#app_env-and-node_env))                                           |
| `NODE_ENV`                                          | **Do not set.** The image sets `production`.                                                                    |
| `PORT`                                              | Set by Railway.                                                                                                 |
| `FRONTEND_URL`                                      | The client's origin, e.g. `https://pos.example.com` (CORS).                                                     |
| `DOMAIN`                                            | The shared parent, e.g. `example.com` (no leading dot; the same value as the client's `VITE_DOMAIN`). Required. |
| `DATABASE_URL`                                      | `mongodb+srv://…` of a replica set.                                                                             |
| `JWT_SECRET`, `COOKIE_SECRET`                       | Two different values from `openssl rand -base64 48`. Placeholders and equal values are refused.                 |
| `JWT_EXPIRY_S`, `REFRESH_EXPIRY_S`                  | Seconds, e.g. `900` and `604800`. The refresh expiry must be longer.                                            |
| `EAN_COUNTER_ID`, `EAN_COUNTER_DIGITS`              | As in `.env.example` (`EAN_COUNTER_DIGITS` must be `9`).                                                        |
| `HEALTH_HEAP_THRESHOLD`, `HEALTH_RSS_THRESHOLD`     | Bytes. `/v1/health/live` fails above them.                                                                      |
| `HEALTH_DISK_THRESHOLD_PERCENT`, `HEALTH_DISK_PATH` | e.g. `0.9` and `/`.                                                                                             |
| `STORE_TIMEZONE`                                    | Optional, default `Asia/Manila`.                                                                                |

Deployed (`prod`/`stage`), the API trusts one proxy hop (Railway's) for the
client IP, and its cookies are `Secure`, `SameSite=Lax` and scoped to
`DOMAIN`.

### Client service

The client is built once into static files. **Every `VITE_*` variable is a
build argument inlined into the JavaScript bundle**: changing one needs a
rebuild (a redeploy of a new build), not just a restart. Railway passes
service variables to the Dockerfile's `ARG`s at build time.

| Build argument     | Value                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_APP_ENV`     | `prod` or `stage` (default `prod`). Replaces `VITE_NODE_ENV`; see [VITE_APP_ENV and VITE_NODE_ENV](#vite_app_env-and-vite_node_env).     |
| `VITE_API_URL`     | The API base URL including `/v1`, no trailing slash, e.g. `https://api.example.com/v1`. Required.                                        |
| `VITE_DOMAIN`      | The same shared parent as the API's `DOMAIN`, e.g. `example.com`. Required in prod/stage (the client clears the session marker with it). |
| `VITE_API_TIMEOUT` | Milliseconds, default `10000`.                                                                                                           |
| `LOGIN_HERO_URL`   | Optional; see [Login photo](#login-photo). Set it empty to skip the fetch.                                                               |

A missing `VITE_API_URL` or `VITE_DOMAIN` fails the build with a message
naming it; other bad values fail in `vite.config.ts`
(`apps/client/src/config/validation.env.ts`).

Runtime variables:

| Variable     | Value                                                                                                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`       | Set by Railway (default `8080` in the image).                                                                                                                                                        |
| `API_ORIGIN` | Optional. The CSP's `connect-src` allows the origin of the `VITE_API_URL` the image was built with; set this only to override it, as an origin (`https://api.example.com`, no path). Normally unset. |

## Security headers

`apps/client/nginx.conf.template` sends on every response:

- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' <API origin>; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`.
    - No inline or eval'd script. The client sets `zod.config({ jitless: true })`
      so zod does not probe `new Function`.
    - No inline styles. Vue applies `:style` bindings through the CSSOM, which
      CSP allows. Templates must not use static `style="…"` attributes: use a
      class or a `<style>` block (`layout-drift.spec.ts` enforces it).
    - `img-src data:` covers the small SVGs Vite inlines (the logo). Fonts
      (`@fontsource/poppins`) and the login photo are same-origin.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`.
- `Strict-Transport-Security: max-age=31536000`, without `includeSubDomains`:
  the client host serves no subdomains, and on an apex domain it would force
  HTTPS on every subdomain of the owner's domain.
- `Cache-Control`: `public, max-age=31536000, immutable` for the hashed
  files in `/assets/`, `no-cache` for everything else (`index.html`, the SPA
  fallback, favicons, the photo).

All `add_header` lines sit at server level. nginx drops every inherited
`add_header` in a location that declares its own, so locations must not add
headers; per-path values go through a `map`.

The API sets its own headers with helmet.

## APP_ENV and NODE_ENV

`APP_ENV` (`dev`, `test`, `stage`, `prod`) is the app's deployment stage.
`prod` and `stage` are "deployed": strict secrets, `DOMAIN` required, `Secure`
cookies, trust proxy. `NODE_ENV` is left to Node: the API image sets
`NODE_ENV=production`, which Express and libraries expect.

Transition (this release only): when `APP_ENV` is unset and `NODE_ENV` is
`dev`, `test`, `stage` or `prod`, the API takes `APP_ENV` from it and logs a
deprecation warning. When both are set and `NODE_ENV` holds one of those
values that differs from `APP_ENV`, the API refuses to start: one of them is
stale, and guessing could run prod with dev rules. `NODE_ENV=production` (or
any value outside that list) never conflicts.

`pnpm seed` follows the same resolution.

## VITE_APP_ENV and VITE_NODE_ENV

The client's stage is `VITE_APP_ENV`, with the same values as `APP_ENV`
(#86). It was called `VITE_NODE_ENV` before. Transition (this release only):

- `VITE_APP_ENV` unset and `VITE_NODE_ENV` set: the build uses
  `VITE_NODE_ENV` and `vite.config.ts` prints a deprecation warning in the
  build log.
- Both set to the same value: the build uses it and warns to remove
  `VITE_NODE_ENV`.
- Both set to different values: the build fails, since one of them is stale.
- Neither set: the Docker build uses `prod`; a local `vite` run fails.

Deploy checklist for each client service (prod and stage):

1. Add the variable `VITE_APP_ENV` with the service's current
   `VITE_NODE_ENV` value (`prod` or `stage`).
2. Remove `VITE_NODE_ENV` (or leave it with the same value until the next
   release; a different value fails the build).
3. Redeploy: the stage is inlined at build time, so it takes a rebuild.
4. Once `VITE_NODE_ENV` is removed, the build log shows no `[env]`
   deprecation warning.

A later release (#86) drops the `VITE_NODE_ENV` fallback.

## Healthchecks

Railway ignores the Dockerfile `HEALTHCHECK` and probes
`deploy.healthcheckPath` from `railway.json`:

- API: `/v1/health/live` (heap, RSS and disk under the `HEALTH_*`
  thresholds). `/v1/health/ready` pings MongoDB.
- Client: `/health`, which returns 503 when `index.html` is missing from the
  image.

Both images also have a `HEALTHCHECK` on the same paths for `docker run` and
docker compose.

## Images

Both run as non-root users: the API as `node`, nginx as `nginx` with its
config, pid and temp files under `/tmp`, listening on `$PORT` (8080 by
default).

Local build and run, from the repo root:

```bash
docker build -f apps/api/Dockerfile -t grocery-pos-api .
docker build -f apps/client/Dockerfile \
  --build-arg VITE_API_URL=http://localhost:3000/v1 \
  --build-arg VITE_DOMAIN=localhost \
  -t grocery-pos-client .

docker run --rm --network host --env-file apps/api/.env grocery-pos-api
docker run --rm -p 8080:8080 grocery-pos-client     # http://localhost:8080
```

For a local run keep `APP_ENV=dev` in `apps/api/.env` (with
`FRONTEND_URL=http://localhost:8080`). The image's `NODE_ENV=production` does
not conflict with it. `--env-file` passes values verbatim, so keep that file
as `.env.example` has it: comments on their own lines, no quotes (`DOMAIN=`,
not `DOMAIN=''`).

## Login photo

The login page's photo (`apps/client/public/images/login-hero.jpg`) is not in
the repo. The client build fetches it from `LOGIN_HERO_URL` (the Unsplash
photo by default, see the README). The fetch is best effort: if it fails the
build carries on and the login page shows its gradient. A photo already in
the build context is used as is.

## One-off migrations

Run by hand at the deploy that needs them, from a checkout of the deployed
commit against the target `DATABASE_URL`. See the README's
[Deploy notes](../README.md#deploy-notes-operator):

- dropping the old `shift_1` sales index (#16);
- `pnpm migrate:decode-entities` (#15), with the API stopped.

## docker compose

`docker-compose.yml` starts only MongoDB, as a single-node replica set, bound
to `127.0.0.1` and **without authentication**. It is for development and the
real-database tests only, never for a deployed database.
