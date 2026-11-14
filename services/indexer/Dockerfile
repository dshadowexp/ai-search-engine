
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY services/indexer/package.json ./services/indexer/package.json
COPY packages ./packages

RUN npm ci

COPY services/indexer ./services/indexer
COPY tsconfig.base.json ./

RUN npm run build --workspace=@search/indexer

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app ./

RUN npm prune --omit=dev

CMD ["npm", "run", "start", "--workspace=@search/indexer"]
