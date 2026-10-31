# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
# better-sqlite3 compiles a native addon; the toolchain stays in this stage only.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
# URL prefix when served under a path-based proxy (e.g. /store/); baked into the web build.
ARG BASE_PATH=/
RUN BASE_PATH="$BASE_PATH" npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production DATA_DIR=/data WEB_DIR=/app/web/dist PORT=3000
WORKDIR /app
COPY package.json ./
COPY server/package.json server/
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/migrations server/migrations
COPY --from=build /app/web/dist web/dist
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD ["node", "server/dist/healthcheck.js"]
CMD ["node", "server/dist/index.js"]
