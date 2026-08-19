# Neo-Lloyds API — production image.
#
# Built from the monorepo root (see the `docker build -f apps/api/Dockerfile .`
# instruction in infrastructure/aws/README.md) because npm workspaces means
# apps/api depends on packages/domain, packages/config and packages/database
# by path, not by a published version -- there is no way to build this image
# from apps/api/ alone.
#
# Not built or run in the sandbox that authored this file: no Docker daemon
# was available there. Everything below follows npm workspaces + Prisma's
# documented conventions; build and run it for real before relying on it.

FROM node:20-bookworm-slim AS base
WORKDIR /repo
# OpenSSL is required by Prisma's query engine on Debian-based images.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/database/package.json packages/database/package.json
COPY apps/api/package.json apps/api/package.json
# Every other workspace's package.json is copied too so `npm ci` resolves
# the full workspace graph identically to CI -- omitting one silently
# changes the lockfile-derived install.
COPY apps/broker-portal/package.json apps/broker-portal/package.json
COPY apps/capital-portal/package.json apps/capital-portal/package.json
COPY apps/corporate-portal/package.json apps/corporate-portal/package.json
COPY apps/admin-portal/package.json apps/admin-portal/package.json
COPY apps/claims-admin-portal/package.json apps/claims-admin-portal/package.json
RUN npm ci

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/domain packages/domain
COPY packages/config packages/config
COPY packages/database packages/database
COPY apps/api apps/api
RUN npm -w @neo-lloyds/database run generate
RUN npm -w @neo-lloyds/config run build
RUN npm -w @neo-lloyds/domain run build
RUN npm -w @neo-lloyds/api run build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /repo

COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/database/package.json packages/database/package.json
COPY apps/api/package.json apps/api/package.json
# Deliberately NOT --omit=dev: @neo-lloyds/database's `prisma` CLI is a
# devDependency, and this same image doubles as the one-off migration task
# (infrastructure/aws/terraform/ecs_migrate.tf runs
# `npx prisma migrate deploy` in it) -- omitting dev deps would build an
# image that runs the API fine but can't migrate. Scoped to just the four
# workspaces this image actually needs, so it's still far smaller than a
# full monorepo install.
RUN npm ci --workspace=@neo-lloyds/api --workspace=@neo-lloyds/domain \
    --workspace=@neo-lloyds/config --workspace=@neo-lloyds/database \
    --include-workspace-root

# Prisma's generated client lives at the repo-root node_modules
# (packages/database/prisma/schema.prisma has no custom `output`), so it
# has to be regenerated against the production node_modules tree rather
# than copied from the build stage's dev install.
COPY packages/database/prisma packages/database/prisma
RUN npm -w @neo-lloyds/database run generate

COPY --from=build /repo/packages/domain/dist packages/domain/dist
COPY --from=build /repo/packages/config/dist packages/config/dist
COPY --from=build /repo/apps/api/dist apps/api/dist

# Least-privilege runtime user (security-model.md §7's least-privilege
# principle applied to the container, not just the database role).
RUN useradd --system --uid 10001 neolloyds
USER neolloyds

EXPOSE 3001
ENV API_PORT=3001
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
    CMD node -e "require('node:http').get('http://127.0.0.1:3001/health', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"

CMD ["node", "apps/api/dist/main.js"]
