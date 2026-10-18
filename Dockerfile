FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run lint && npm run build && npm run test:release

FROM node:22-bookworm-slim AS runner

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/wrangler.local.jsonc ./wrangler.local.jsonc
COPY scripts/backup-service.py ./scripts/backup-service.py
COPY scripts/honaz-sync.py ./scripts/honaz-sync.py
COPY integrations/honaz ./integrations/honaz

ENV NODE_ENV=production \
    WRANGLER_SEND_METRICS=false

EXPOSE 8787

CMD ["sh", "-c", "npx wrangler d1 migrations apply DB --local --persist-to /data --config wrangler.local.jsonc || exit; python3 /app/scripts/backup-service.py & exec npx wrangler dev --config dist/server/wrangler.json --env-file /app/.dev.vars --local --persist-to /data --ip 0.0.0.0 --port 8787 --log-level info"]
