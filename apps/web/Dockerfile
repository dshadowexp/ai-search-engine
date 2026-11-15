
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages ./packages

RUN npm ci

COPY apps/web ./apps/web
COPY tsconfig.base.json ./

RUN npm run build --workspace=@search/web

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Copy standalone Next.js server
COPY --from=builder /app/apps/web/.next/standalone ./

# Copy static assets
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static

COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
