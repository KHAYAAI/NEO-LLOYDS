# @neo-lloyds/database

Prisma schema and migrations for Neo-Lloyds. Phase 1 covers identity and the
risk graph only; later phases add their own migrations.

```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d postgres
cp .env.example .env
npm run db:generate
npm -w @neo-lloyds/database run migrate:dev
```

The initial migration additionally revokes `UPDATE` and `DELETE` on
`AuditRecord` from the application role, so append-only is enforced by the
database and not merely by convention.
