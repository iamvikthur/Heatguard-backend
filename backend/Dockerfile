# Build context: repository root (the backend reads ../data/raw for replays).
FROM node:22-slim
# Prisma's migration engine needs OpenSSL, which the slim image leaves out.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g bun@1
WORKDIR /app/backend

COPY backend/package.json backend/bun.lock backend/prisma.config.ts ./
COPY backend/prisma ./prisma
# postinstall runs `prisma generate`; the config wants a URL but generate never connects.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build bun install --frozen-lockfile

COPY backend/ ./
RUN bun run build
COPY data/raw /app/data/raw

ENV NODE_ENV=production
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/main.js"]
