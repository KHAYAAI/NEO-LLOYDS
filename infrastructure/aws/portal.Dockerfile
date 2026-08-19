# Neo-Lloyds portal image — one Dockerfile, five portals.
#
# Build from the monorepo root, selecting the portal by build-arg:
#   docker build -f infrastructure/aws/portal.Dockerfile \
#     --build-arg PORTAL=admin-portal \
#     -t neo-lloyds/admin-portal .
#
# PORTAL must be one of: broker-portal, capital-portal, corporate-portal,
# admin-portal, claims-admin-portal.
#
# Uses Next.js `output: 'standalone'` (enabled in every portal's
# next.config.mjs) to produce a minimal, self-contained server bundle --
# the standard pattern for containerising a Next.js App Router app, not a
# custom one. Not built or run in the sandbox that authored this file (no
# Docker daemon available there); `next build` itself, and the resulting
# .next/standalone output, were verified locally.

FROM node:20-bookworm-slim AS deps
ARG PORTAL
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/package.json
COPY apps/${PORTAL}/package.json apps/${PORTAL}/package.json
RUN npm ci

FROM deps AS build
ARG PORTAL
COPY tsconfig.base.json ./
COPY packages/domain packages/domain
COPY apps/${PORTAL} apps/${PORTAL}
RUN npm -w @neo-lloyds/domain run build
RUN npm -w @neo-lloyds/${PORTAL} run build

FROM node:20-bookworm-slim AS runtime
ARG PORTAL
ENV NODE_ENV=production
WORKDIR /app

# The standalone output already contains its own minimal node_modules
# (only what each route actually needs) and a self-sufficient server.js --
# nothing from the monorepo's own node_modules is required at runtime.
COPY --from=build /repo/apps/${PORTAL}/.next/standalone ./
COPY --from=build /repo/apps/${PORTAL}/.next/static ./apps/${PORTAL}/.next/static
COPY --from=build /repo/apps/${PORTAL}/public ./apps/${PORTAL}/public

RUN useradd --system --uid 10001 neolloyds
USER neolloyds

EXPOSE 3000
ENV PORT=3000
# Baked into the image (not just available at build time) because exec-form
# CMD below does not expand ARGs -- only ENV, and only in shell form.
ENV PORTAL=${PORTAL}
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
    CMD node -e "require('node:http').get('http://127.0.0.1:3000/login', r => process.exit(r.statusCode<500?0:1)).on('error', () => process.exit(1))"

# Next's standalone server.js lives nested under the portal's own
# workspace path (a quirk of how `output: standalone` mirrors the
# monorepo layout) -- confirmed by inspecting a real `next build` output,
# not assumed: apps/<portal>/server.js, not ./server.js.
CMD node "apps/$PORTAL/server.js"
