
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages ./packages

RUN npm ci

COPY apps/api ./apps/api
COPY tsconfig.base.json ./

RUN npm run build --workspace=@search/api

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app ./

RUN npm prune --omit=dev

EXPOSE 4000

CMD ["npm", "run", "start", "--workspace=@search/api"]
