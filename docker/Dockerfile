# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app

RUN apk add --no-cache python3 make g++ && corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build
RUN pnpm prune --prod

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    DEPLOYMENT=self-hosted \
    PORT=3000 \
    AA_SQLITE_PATH=/data/agent-artifacts.db

RUN addgroup -S -g 1001 aa \
  && adduser -S -u 1001 -G aa aa \
  && mkdir -p /data \
  && chown -R aa:aa /data /app

COPY --from=build --chown=aa:aa /app/package.json ./package.json
COPY --from=build --chown=aa:aa /app/node_modules ./node_modules
COPY --from=build --chown=aa:aa /app/dist ./dist
COPY --from=build --chown=aa:aa /app/public ./public
COPY --from=build --chown=aa:aa /app/drizzle ./drizzle
COPY --from=build --chown=aa:aa /app/templates ./templates

USER aa
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "dist/index.js"]
