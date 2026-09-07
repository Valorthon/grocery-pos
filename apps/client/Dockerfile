# syntax=docker/dockerfile:1

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install -g pnpm@10.33.0

# --- build stage ---
FROM base AS build
WORKDIR /app

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

# build-time env vars injected by Railway.
# vite.config.ts validates these and fails the build if they are wrong.
ARG VITE_NODE_ENV=prod
ARG VITE_API_URL
ARG VITE_API_TIMEOUT=10000
ARG VITE_DOMAIN=

ENV VITE_NODE_ENV=$VITE_NODE_ENV
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_API_TIMEOUT=$VITE_API_TIMEOUT
ENV VITE_DOMAIN=$VITE_DOMAIN

RUN pnpm --filter grocery-pos-client build

# --- nginx runtime stage ---
FROM nginx:alpine AS runtime

COPY --from=build /app/apps/client/dist /usr/share/nginx/html
COPY apps/client/nginx.conf.template /etc/nginx/nginx.conf.template
COPY apps/client/docker-entrypoint.sh /docker-entrypoint.sh

RUN chmod +x /docker-entrypoint.sh

EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
