# Phase 1 — Implementation Report

> SIMULATION / TEST ENVIRONMENT — NOT INSURANCE.

**Scope:** Identity + Risk Ontology + Risk Graph.
**Status:** Delivered and verified against PostgreSQL.

## What was built

**`packages/domain`** — the dependency-free core. Ontology (16 node types, 17
edge rules), `RiskGraph` with validated edge insertion and bounded traversal,
the seven graph queries, exact integer money, mandatory-uncertainty estimates,
provenance, RBAC/tenant/agent-mandate checks, and audit record construction.

**`packages/database`** — Prisma schema and two migrations: the Phase 1 tables,
and a trigger making `AuditRecord` append-only.

**`apps/api`** — NestJS API with identity, ontology and risk-graph modules;
credential guard; global simulation-notice interceptor; domain exception
filter; OpenAPI at `/docs`; and a seed script that builds the MVP shipment
scenario.

## Verification

| Check | Result |
|---|---|
| `npm test` | 65 passed (41 domain, 24 API e2e) |
| `npm run typecheck` | clean, both workspaces, src and tests |
| `npm run lint` | clean |
| `prisma migrate deploy` | both migrations applied |
| Live API on PostgreSQL | Q1–Q7 answered from seeded data |

Verified by hand against the running service: unauthenticated write → 401; wrong
secret → 401; `DEPENDS_ON` cycle → 422 `DEPENDENCY_CYCLE`; `DELETE` on
`AuditRecord` → rejected by the database; audit rows written for every
node/edge/identity mutation.

The MVP graph query returns what it should: the second exporter appears as
*indirectly exposed* to the port-closure risk and as a correlated entity,
because both companies depend on the same berth — which is the whole point of
modelling risk as a graph rather than a policy table.

## Two decisions worth flagging

**The API test suite compiles with SWC, not esbuild.** NestJS DI and
class-validator both depend on `emitDecoratorMetadata`, which esbuild does not
emit. Under esbuild the tests passed while request validation silently did
nothing — a suite that proves nothing. `vitest.config.ts` uses SWC so the tests
exercise the same behaviour the tsc-built production bundle has. Constructor
injection is also written with explicit `@Inject` tokens rather than relying on
reflected parameter types.

**Graph reads tolerate edges that are no longer legal.** `loadGraph` skips a
persisted edge that fails current ontology validation instead of failing the
whole query. Edges are validated on write, so this only arises after an ontology
change — a migration concern. The alternative (failing reads) would make an
ontology change an outage.

## Known gaps

Stated plainly rather than papered over:

- No OIDC, no KYB/KYC provider, no sanctions screening. `kybStatus` is set
  manually and means nothing yet.
- No rate limiting, no HSM for key material, no penetration testing.
- `loadSubgraph` loads an organisation's whole graph into memory. Correct and
  fast at prototype scale; ADR-0003 records the point at which it must become a
  bounded recursive CTE.
- `correlatedEntities` is O(entities × dependency-closure). Fine for hundreds of
  entities, not for the 100-company synthetic dataset at interactive latency.
- Redis/BullMQ and MinIO are in the compose file but unused until Phase 2.
- The synthetic datasets specified in §28 of the brief (100 companies, 1,000
  assets, 5,000 dependencies, …) are **not** generated yet — the seed builds only
  the MVP scenario. Bulk generation belongs with Phase 2 scoring, which is what
  gives that volume of data anything to do.
- No web UI. The Phase 1 deliverable is the API and domain core; the dashboard
  described in §29 arrives with the data to populate it.

## Next

Phase 2 — risk submission, deterministic scoring, and the AI analyst as a
strictly advisory adapter whose every output carries model id, version,
timestamp, confidence and referenced sources.
