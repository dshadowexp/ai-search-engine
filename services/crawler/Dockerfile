
# Build stage
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Copy dependency manifests first for Docker layer caching
COPY package.json package-lock.json ./
COPY services/crawler/package.json ./services/crawler/package.json
COPY packages ./packages

# Install workspace dependencies
RUN npm ci

# Copy crawler source
COPY services/crawler ./services/crawler
COPY tsconfig.base.json ./

# Compile TypeScript
RUN npm run build --workspace=@search/crawler

# Production stage
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app ./

# Remove development dependencies
RUN npm prune --omit=dev

CMD ["npm", "run", "start", "--workspace=@search/crawler"]
