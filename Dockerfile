# syntax=docker/dockerfile:1.7

# ═══════════════════════════════════════════════════════════════
# RCC-HIROS — production image
#
#   runner  : Next.js standalone server (what the tunnel serves)
#   migrate : Prisma CLI + seed tooling, no web server
#
# Debian slim (glibc) is deliberate: sharp and @react-pdf/renderer
# ship prebuilt glibc binaries; Alpine's musl would need extra layers.
# ═══════════════════════════════════════════════════════════════

FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# ── deps: full dependency tree (build + migrations) ──
FROM base AS deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ── build: prisma client + next production build ──
FROM deps AS build
COPY prisma ./prisma
COPY prisma.config.ts next.config.ts postcss.config.mjs tsconfig.json ./
COPY src ./src
COPY public ./public

# Build-time placeholders only. Server-side env is read at runtime; only
# NEXT_PUBLIC_* values are inlined into the client bundle.
ARG DATABASE_URL="mysql://build:build@127.0.0.1:3306/rcc_hiros"
ARG JWT_SECRET="build-time-placeholder-not-used-at-runtime"
ARG NEXT_PUBLIC_KIOSK_SERVICE_URL="http://127.0.0.1:8765"
ENV DATABASE_URL=$DATABASE_URL \
    JWT_SECRET=$JWT_SECRET \
    NEXT_PUBLIC_KIOSK_SERVICE_URL=$NEXT_PUBLIC_KIOSK_SERVICE_URL

RUN npx prisma generate && npm run build

# ── migrate: prisma CLI + seed scripts ──
FROM build AS migrate
CMD ["npx", "prisma", "migrate", "deploy"]

# ── runner: minimal runtime ──
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs --create-home nextjs

COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

# Uploads live in a mounted volume; the directory must exist and be writable
# before the process drops privileges.
RUN mkdir -p /app/uploads && chown -R nextjs:nodejs /app/uploads

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
