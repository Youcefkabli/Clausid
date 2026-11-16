FROM node:24.11.1-bookworm AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/auth/package.json apps/auth/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm_config_nodedir=/usr/local pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM build AS runtime
RUN mkdir -p /var/lib/clausid/auth /var/lib/clausid/contracts && chown -R node:node /var/lib/clausid
USER node

FROM caddy:2.10.2-alpine AS web
COPY --from=build /app/apps/web/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile

FROM rust:1.93.1-bookworm AS pdf-build
WORKDIR /pdf
COPY packages/pdf-engine/ ./
RUN rustup target add wasm32-unknown-unknown \
 && cargo install wasm-bindgen-cli --version 0.2.130 --locked \
 && sh build.sh

FROM runtime AS pdf
COPY --from=pdf-build /pdf/dist/ /app/packages/pdf-engine/dist/
