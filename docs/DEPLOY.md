# Deploying Grocery POS

Production and staging run on [Railway](https://railway.com) (project
`grocery-pos`, environments `staging` and `production`) as three services:
the API (`apps/api`) and the client (`apps/client`, static files served by
nginx), built from this repo's Dockerfiles, and `mongo`, a MongoDB replica set
on a Railway volume (transactions need a replica set; see
[MongoDB](#mongodb)). An external replica set such as Atlas works too: point
`DATABASE_URL` at it and drop the `mongo` service.

| Environment  | Branch       | Client                        | API                               |
| ------------ | ------------ | ----------------------------- | --------------------------------- |
| `staging`    | `staging`    | `staging.pos.valorthon.store` | `api.staging.pos.valorthon.store` |
| `production` | `production` | `app.pos.valorthon.store`     | `api.app.pos.valorthon.store`     |

Each environment's cookie parent (`DOMAIN`) is its client host:
`staging.pos.valorthon.store` and `app.pos.valorthon.store`. They are
siblings, so neither environment's cookies are ever sent to the other's
hosts. Never use `pos.valorthon.store` itself as a `DOMAIN`: it is the parent
of staging, so production's `jwt` and `refresh` cookies would reach the
staging API, and a browser logged into both would send two cookies of each
name. Promote by moving
`develop` to `staging`, then `staging` to `production`.

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

1. List the domains in `.railway/railway.ts` and apply it (see
   [Service settings](#service-settings-railwayrailwayts)), or add them in each
   service (Settings, Networking). Create the DNS records Railway shows: a
   CNAME per host plus a `_railway-verify.<host>` TXT record. The DNS for
   `valorthon.store` is at Namecheap (Advanced DNS; the Host field takes the
   name without `.valorthon.store`). Railway issues the certificates once both
   records resolve, usually within minutes.
2. Use them in the variables below: `FRONTEND_URL`, `DOMAIN`, `VITE_API_URL`,
   `VITE_DOMAIN`.

## Service settings (`.railway/railway.ts`)

`.railway/railway.ts` declares the three services for one environment: each
one's source (the environment's branch, or the `mongo:7.0` image), Dockerfile,
the paths that trigger a rebuild (watch patterns), healthcheck, custom domains
and the Mongo volume. It replaced the per-app `railway.json` files (#92):
Railway deprecated config-as-code, refuses it for new services, and stops
reading those files on 2026-12-01. Every service builds from the repo root,
because both images need `packages/contracts`.

Railway does not read the file during a deploy; apply a change by hand from
the repo root, after `railway link` to the project:

```bash
railway config plan --environment staging    # preview; "already up to date" when nothing changed
railway config apply --environment staging
```

Run it as a plain command: the `railway` SDK (a root dev dependency) checks the
CLI version through the shell's `$_`, so wrapping it in `timeout` or similar
fails with "requires Railway CLI 5.42.1 or newer". The SDK is pinned exactly
(`railway` 3.16.0) because it checks for a minimum CLI version; upgrade the
two together. Variables are unmanaged:
the file never reads or writes them, so secrets stay in Railway. Set them per
service as below.

## Services and variables

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
| `HEALTH_HEAP_THRESHOLD`, `HEALTH_RSS_THRESHOLD`     | Bytes. `/v1/health/live` fails above them. See [Memory thresholds](#memory-thresholds).                         |
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
| `VITE_APP_ENV`     | `prod` or `stage` (default `prod`). See [VITE_APP_ENV](#vite_app_env).                                                                   |
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

- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' <API origin>; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; report-to csp-endpoint; report-uri <API origin>/v1/csp-report`.
    - No inline or eval'd script. The client sets `zod.config({ jitless: true })`
      so zod does not probe `new Function`.
    - No inline styles. Vue applies `:style` bindings through the CSSOM, which
      CSP allows. Templates must not use static `style="…"` attributes: use a
      class or a `<style>` block (`layout-drift.spec.ts` enforces it).
    - `img-src data:` covers the small SVGs Vite inlines (the logo). Fonts
      (`@fontsource/poppins`) and the login photo are same-origin.
    - Violations are reported to the API (see
      [CSP violation reports](#csp-violation-reports)).
- `Reporting-Endpoints: csp-endpoint="<API origin>/v1/csp-report"`, the
  endpoint the CSP's `report-to` names.
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`:
  the POS uses none of these, so nothing on the page may ask for them.
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

### CSP violation reports

Browsers report CSP violations to the API's `POST /v1/csp-report`
(`apps/api/src/csp-report`), which logs one warn line per report and
answers 204. No third party receives them.

- Two formats: Chromium uses `report-to` (the Reporting API,
  `application/reports+json`, an array, batched and sent a little later);
  browsers without it use `report-uri` (`application/csp-report`, one report
  per request). A browser that supports `report-to` ignores `report-uri`.
- A line reads
  `[<request id>] CSP violation: directive=… blocked=… document=…`.
  Query strings, fragments and user info are stripped from the URIs; the
  rest of the report (samples, the policy), headers and cookies are never
  logged. At most 5 reports of one request are logged, the rest counted.
- A violation (directive + blocked + document, as logged) is logged once a
  minute; its repeats in that minute are counted and summarised at the
  minute's end in one line,
  `[<request id of the first line>] CSP violation repeated N more time(s) in this window: …`
  ("time" for 1, "times" otherwise).
  At most 1000 distinct violations are tracked a minute; beyond that, new
  ones are only counted in one line,
  `CSP violation: N reports of other violations not logged in this window (1000 distinct already)`.
  So a flood of distinct (e.g. forged) violations can hide a genuinely new
  one behind that count until the next minute.
- The route is public, rate-limited to 60 requests a minute per IP (every
  POST counts, including ones refused while parsing: the limit runs before
  any body parser, and a blocked client's body is not read). A refused
  request still gets the usual 429 body and headers, but no warn line of
  its own: they are counted per client IP (the same `req.ip` the limit
  uses) and logged once a minute as
  `CSP reports rate-limited: N from <client IP> in this window`, for at
  most 1000 IPs a minute (the rest in one "from other IPs" line).
- The route parses only those two media types, capped at 16KB (413
  above), on that route alone. Malformed JSON or a body that is not a report is a 400 with
  a fixed message; nothing is echoed back. Any other media type is a 415.
- On every route, a body the parsers refuse (too large, malformed, an
  unsupported charset or `Content-Encoding`, ...) gets a fixed message per
  error type, and only the type is logged: body-parser's own messages
  quote the request's headers or body.
- The path's `/v1` is the API's URI version; `<API origin>` is the same
  `API_ORIGIN` as `connect-src`. Reports are not subject to `connect-src`
  (their fetch destination is `report`), so it needs no extra source.
- CORS: `report-uri` reports are sent `no-cors` and need nothing. Chromium
  sends a `report-to` upload cross-origin with a CORS preflight (`OPTIONS`,
  `Access-Control-Request-Headers: content-type`) and no cookies, and drops
  the report unless the answer allows the client's origin. The API's CORS
  config (`FRONTEND_URL`) already does, so **`FRONTEND_URL` must be exactly
  the client's origin** or `report-to` reports are lost (and so is the app).
  Chromium only uploads `report-to` reports to an `https` endpoint (it
  queued them forever for `http://localhost` in testing).

## APP_ENV and NODE_ENV

`APP_ENV` (`dev`, `test`, `stage`, `prod`) is the app's deployment stage.
`prod` and `stage` are "deployed": strict secrets, `DOMAIN` required, `Secure`
cookies, trust proxy. `NODE_ENV` is left to Node: the API image sets
`NODE_ENV=production`, which Express and libraries expect.

`APP_ENV` is required: when it is unset, blank or not one of those values the
API refuses to start. `NODE_ENV` is never read as the stage (the one-release
fallback from `NODE_ENV` was removed in #86), so a stale `NODE_ENV=prod`
neither supplies nor conflicts with `APP_ENV`. `pnpm seed` reads `APP_ENV`
the same way.

## VITE_APP_ENV

The client's stage is `VITE_APP_ENV`, with the same values as `APP_ENV`
(#86). The old name `VITE_NODE_ENV` is no longer read. With `VITE_APP_ENV`
unset the Docker build uses `prod`; a local `vite` run fails. Set it on each
client service and remove any leftover `VITE_NODE_ENV`; the stage is inlined
at build time, so a change takes a rebuild.

## Healthchecks

Railway ignores the Dockerfile `HEALTHCHECK` and probes the service's
`healthcheck` from `.railway/railway.ts` (300 s timeout):

- API: `/v1/health/live` (heap, RSS and disk under the `HEALTH_*`
  thresholds). `/v1/health/ready` pings MongoDB.
- Client: `/health`, which returns 503 when `index.html` is missing from the
  image.

Both images also have a `HEALTHCHECK` on the same paths for `docker run` and
docker compose.

### Memory thresholds

`.env.example`'s 150 MB (`157286400`) suits local development, not a deployed
API: a live check that fails makes Railway restart the service. Staging
measured about 70 MB idle and a 205 MB container peak (while seeding) on
2026-11-06, so it runs with `HEALTH_HEAP_THRESHOLD=314572800` (300 MB) and
`HEALTH_RSS_THRESHOLD=419430400` (400 MB). Use the same in production, then
check `railway metrics --service api --memory --since 7d` after a week of real
traffic and keep both thresholds well above the observed peak.

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

## MongoDB

The `mongo` service runs `mongo:7.0` on the volume `mongo-volume` (5 GB,
`/data/db`), as the single-node replica set `rs0` with authentication. Its
start command (in `.railway/railway.ts`) creates a replica-set keyfile on the
volume once. It is reachable only on Railway's private network, as
`mongo.railway.internal:27017`; there is no public TCP proxy.

Variables: `MONGO_INITDB_ROOT_USERNAME` (`root`) and a random
`MONGO_INITDB_ROOT_PASSWORD`, read only when the volume is empty. The API's
`DATABASE_URL` is then:

```text
mongodb://root:<password>@mongo.railway.internal:27017/grocery_pos?replicaSet=rs0&authSource=admin
```

On a new environment, initiate the replica set once after the first deploy:

```bash
railway ssh --service mongo -e <env> -- bash -c 'mongosh -u root -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --eval "rs.initiate({_id: \"rs0\", members: [{_id: 0, host: \"mongo.railway.internal:27017\"}]})"'
```

The member host must be the private name, so a client outside Railway can
only connect with `directConnection=true` (through a TCP proxy, which is
normally off).

**Backups:** Railway's volume backups (manual and scheduled) need a Pro
workspace; the project is not on Pro, so the volume currently has none. Set up
backups before production holds real data.

### Seeding a deployed environment

`pnpm seed` drops every collection, and the API image has no `ts-node`. For
staging, transpile `apps/api/seed.ts` to CommonJS (drop the `dotenv/config`
import and point `./src/` imports at `/app/apps/api/dist/`) and run it inside
the API container over `railway ssh`, with
`NODE_PATH=/app/apps/api/node_modules` and `--force-destroy-data`. Then
replace the seeded accounts' shared `password123` (an ADMIN's
`PATCH /v1/users`, and `PATCH /v1/users/me/password` for the admin itself),
because the deployed hosts are public. Never seed production.

## docker compose

`docker-compose.yml` starts only MongoDB, as a single-node replica set, bound
to `127.0.0.1` and **without authentication**. It is for development and the
real-database tests only, never for a deployed database.
