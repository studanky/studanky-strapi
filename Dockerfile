# syntax=docker/dockerfile:1.6

# =============================================================================
# Stage 1: Builder
# =============================================================================
FROM node:22-alpine AS builder

# TODO(lucinka-old-cpu): Server-specific workaround — REMOVE once Strapi runs on
# a CPU with x86-64-v2 (SSE4.2/POPCNT). The current host (Intel Xeon X5355, 2007)
# lacks those, so sharp's bundled prebuilt libvips SIGILLs at runtime. We instead
# compile sharp from source against the system libvips (apk `vips`), which does
# runtime CPU feature dispatch and falls back safely — at the cost of a slower
# build. To revert on modern hardware: drop `pkgconf`/`python3` below, delete the
# `SHARP_FORCE_GLOBAL_LIBVIPS` line and the "Force sharp from source" RUN step.
# Verify the CPU first: `grep -o 'sse4_2' /proc/cpuinfo` (empty = keep this).

# Build dependencies for native modules (sharp/vips for images, better-sqlite3).
# python3 is required by node-gyp to compile sharp from source.
RUN apk add --no-cache build-base gcc autoconf automake zlib-dev libpng-dev vips-dev pkgconf python3

WORKDIR /app

ENV SHARP_FORCE_GLOBAL_LIBVIPS=1

# Install dependencies (cached unless package files change)
COPY package*.json ./
RUN npm ci

# Build admin panel + compile TypeScript, then drop dev dependencies
COPY . .
RUN npm run build && npm prune --omit=dev

# Force sharp from source (lucinka-old-cpu): the prebuilt @img binaries assume
# SSE4.2. Remove them and reinstall sharp with --omit=optional (so npm cannot
# re-add the prebuilts), which makes sharp compile its own binding from source
# against the system libvips (runtime CPU dispatch). SHARP_FORCE_GLOBAL_LIBVIPS
# is set above. The final require() runs on the build host (same CPU as runtime),
# so the build FAILS loudly here if sharp still cannot load.
RUN rm -rf node_modules/@img/sharp-* \
 && npm install --no-save --no-package-lock --omit=optional \
      sharp node-addon-api node-gyp \
 && node -e "require('sharp'); console.log('sharp loads OK on this CPU')"

# =============================================================================
# Stage 2: Production
# =============================================================================
FROM node:22-alpine AS production

# Runtime image processing only — no build toolchain
RUN apk add --no-cache vips

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
