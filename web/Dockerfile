# Build context: repository root.
FROM node:22-slim
RUN npm install -g bun@1
WORKDIR /app

COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ .

# Next.js bakes this into the browser bundle, so it must exist at build time.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN bun run build

ENV NODE_ENV=production
CMD ["sh", "-c", "./node_modules/.bin/next start --port ${PORT:-3000}"]
