# syntax=docker/dockerfile:1

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install -g pnpm@10.33.0

# --- build-arg check ---
# Fails in seconds, before the install, with a clear message (vite.config.ts
# would only fail after it). A stage of its own so these ARGs don't bust the
# install's cache; the build stage waits for its marker file.
FROM base AS build-args
ARG VITE_NODE_ENV=prod
ARG VITE_API_URL
ARG VITE_DOMAIN
RUN if [ -z "$VITE_API_URL" ]; then \
        echo "Build arg VITE_API_URL is required, e.g. --build-arg VITE_API_URL=https://api.example.com/v1" >&2; exit 1; \
    fi; \
    if [ "$VITE_NODE_ENV" = prod ] || [ "$VITE_NODE_ENV" = stage ]; then \
        if [ -z "$VITE_DOMAIN" ]; then \
            echo "Build arg VITE_DOMAIN is required when VITE_NODE_ENV=$VITE_NODE_ENV: the shared parent domain, e.g. --build-arg VITE_DOMAIN=example.com" >&2; exit 1; \
        fi; \
    fi \
    && touch /build-args-ok

# --- build stage ---
FROM base AS build
WORKDIR /app
COPY --from=build-args /build-args-ok /tmp/build-args-ok

# prevent husky from installing git hooks during install
ENV HUSKY=0

# copy workspace manifests first for better caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/client/package.json ./apps/client/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json

RUN pnpm install --frozen-lockfile

# copy source and build the shared contracts, then the client
COPY packages/contracts ./packages/contracts
COPY apps/client ./apps/client

RUN pnpm --filter @grocery-pos/contracts build

# Build args (Railway passes service variables of the same name). They are
# inlined into the bundle, so changing one needs a rebuild. See
# docs/DEPLOY.md. VITE_API_URL and VITE_DOMAIN have no usable default.
ARG VITE_NODE_ENV=prod
ARG VITE_API_URL
ARG VITE_API_TIMEOUT=10000
ARG VITE_DOMAIN

ENV VITE_NODE_ENV=$VITE_NODE_ENV
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_API_TIMEOUT=$VITE_API_TIMEOUT
ENV VITE_DOMAIN=$VITE_DOMAIN

# Optional login photo (gitignored, see README). Best effort: when the fetch
# fails the build goes on and the login page shows its gradient.
ARG LOGIN_HERO_URL="https://images.unsplash.com/photo-1542838132-92c53300491e?w=1600&q=70&fm=jpg"
RUN if [ -n "$LOGIN_HERO_URL" ] && [ ! -f apps/client/public/images/login-hero.jpg ]; then \
        mkdir -p apps/client/public/images && \
        node -e "fetch(process.argv[1], { signal: AbortSignal.timeout(30000) }).then(async (r) => { if (!r.ok) throw new Error('HTTP ' + r.status); require('fs').writeFileSync(process.argv[2], Buffer.from(await r.arrayBuffer())); }).catch((e) => { console.warn('login hero photo not fetched (' + e.message + '); the login page shows its gradient'); })" \
            "$LOGIN_HERO_URL" apps/client/public/images/login-hero.jpg; \
    fi

RUN pnpm --filter grocery-pos-client build

# The CSP's connect-src default (docker-entrypoint.sh): the API's origin.
RUN node -e "console.log(new URL(process.env.VITE_API_URL).origin)" > /app/api-origin

# --- nginx runtime stage (unprivileged) ---
FROM nginx:alpine AS runtime

COPY --from=build /app/apps/client/dist /usr/share/nginx/html
COPY --from=build /app/api-origin /etc/nginx/api-origin
COPY apps/client/nginx.conf.template /etc/nginx/nginx.conf.template
COPY apps/client/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod 755 /docker-entrypoint.sh

# Railway sets PORT; this is the local default. Above 1024, so no root needed.
ENV PORT=8080
EXPOSE 8080

# The stock nginx user: config, pid and temp files go under /tmp.
USER nginx

# Local and docker compose use only: Railway ignores HEALTHCHECK and probes
# railway.json's healthcheckPath (/health) instead.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health" || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-e", "stderr", "-c", "/tmp/nginx.conf", "-g", "daemon off;"]
