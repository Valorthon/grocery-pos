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
COPY apps/api/package.json ./apps/api/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json

RUN pnpm install --frozen-lockfile

# copy source and build the shared contracts, then the api
COPY packages/contracts ./packages/contracts
COPY apps/api ./apps/api

RUN pnpm --filter @grocery-pos/contracts build
RUN pnpm --filter grocery-pos-api build

# --- production runtime stage ---
FROM base AS runtime
WORKDIR /app

ENV NODE_ENV=prod
ENV HUSKY=0

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist

# the root prepare script runs `husky`, which is not installed with --prod,
# so provide a no-op placeholder while keeping HUSKY=0 to skip hook setup
RUN printf '#!/bin/sh\nexit 0\n' > /usr/local/bin/husky && chmod +x /usr/local/bin/husky
RUN pnpm install --prod --frozen-lockfile

EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
