# syntax=docker/dockerfile:1

# ==============================================================================
# Stage 1: dependencies
#
# Split from the build so a source-only change reuses the cached install layer.
# ==============================================================================
FROM node:22-alpine AS deps

RUN apk add --no-cache libc6-compat

WORKDIR /app

COPY package.json package-lock.json* bun.lock* ./

# npm ci when a lockfile is present, npm install otherwise, so the image builds
# from a fresh clone either way.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# ==============================================================================
# Stage 2: build
# ==============================================================================
FROM node:22-alpine AS builder

RUN apk add --no-cache libc6-compat

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Stamped into the health endpoint so a running container can be traced back
# to the commit that produced it.
ARG GIT_HASH=dev
ENV GIT_HASH=${GIT_HASH}

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build

# ==============================================================================
# Stage 3: runner
# ==============================================================================
FROM node:22-alpine AS runner

RUN apk add --no-cache dumb-init libc6-compat

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

ARG GIT_HASH=dev
ENV GIT_HASH=${GIT_HASH}

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# The standalone output carries its own minimal server plus the traced
# dependencies, so no second npm install is needed here.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# All state lives in Postgres, so the container is stateless and needs no
# volume: a redeploy replaces it wholesale with nothing to preserve.

USER nextjs

EXPOSE 3000

# Reports unhealthy when the database is unreachable, not merely when the
# process is alive: an instance that cannot sign anyone in should not receive
# traffic.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
