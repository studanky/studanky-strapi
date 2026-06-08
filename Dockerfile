# syntax=docker/dockerfile:1.6

# =============================================================================
# Stage 1: Builder
# =============================================================================
FROM node:22-alpine AS builder

# Build dependencies for native modules (sharp/vips for images, better-sqlite3)
RUN apk add --no-cache build-base gcc autoconf automake zlib-dev libpng-dev vips-dev

WORKDIR /app

# Install dependencies (cached unless package files change)
COPY package*.json ./
RUN npm ci

# Build admin panel + compile TypeScript, then drop dev dependencies
COPY . .
RUN npm run build && npm prune --omit=dev

# =============================================================================
# Stage 2: Production
# =============================================================================
FROM node:22-alpine AS production

# Runtime image processing and Coolify healthcheck support — no build toolchain
RUN apk add --no-cache vips curl

ENV NODE_ENV=production \
    STRAPI_TELEMETRY_DISABLED=true \
    STRAPI_DISABLE_UPDATE_NOTIFICATION=true

WORKDIR /app

# Copy the built application from the builder stage
COPY --from=builder --chown=node:node /app ./

# Writable runtime directories (uploads when using local storage; migrations)
RUN mkdir -p /app/public/uploads /app/database/migrations \
    && chown -R node:node /app/public/uploads /app/database

VOLUME ["/app/public/uploads"]

# Run as the non-root user shipped with the node image
USER node

EXPOSE 1337

# Strapi answers /_health with 204 when up
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "require('http').get('http://localhost:1337/_health', (r) => process.exit(r.statusCode === 204 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["npm", "run", "start"]
