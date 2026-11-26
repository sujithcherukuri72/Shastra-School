# syntax=docker/dockerfile:1
# Build context: repository root.  docker build -f apps/api/Dockerfile .
FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
# Production dependencies only; install scripts disabled by .npmrc (ignore-scripts=true).
RUN npm ci --omit=dev --workspace apps/api --include-workspace-root=false && npm cache clean --force

FROM node:26-alpine AS runtime
ENV NODE_ENV=production \
    NODE_OPTIONS="--disable-warning=ExperimentalWarning" \
    UPLOAD_DIR=/data/storage
WORKDIR /app
RUN apk add --no-cache tini && mkdir -p /data/storage && chown -R node:node /data
COPY --from=deps --chown=root:root /app/node_modules ./node_modules
COPY --chown=root:root apps/api/package.json apps/api/package.json
COPY --chown=root:root apps/api/src apps/api/src
WORKDIR /app/apps/api
# Code is owned by root and read-only to the app user; only /data is writable.
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.ts"]
