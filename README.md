# Neo-Lloyds

**AI-native risk-capital marketplace infrastructure.**

> ## SIMULATION / TEST ENVIRONMENT — NOT INSURANCE
>
> Neo-Lloyds is a technology prototype. It is **not** an insurer, **not** a
> licensed financial services provider, and **not** authorised insurance
> infrastructure in any jurisdiction. Nothing it produces is a contract of
> insurance, a quotation, financial advice, or a regulated offer. All figures
> in this repository are synthetic test data.

Neo-Lloyds is not modelled as an insurance company. It is a marketplace and
infrastructure layer that makes economic risk measurable, priceable,
transferable and financeable — by machines as well as by people. Strategic HQ:
Johannesburg; the architecture is globally deployable and jurisdiction-neutral
at its core.

## Status: Phase 1 delivered

| Phase | Scope | State |
|---|---|---|
| 1 | Identity · Risk ontology · Risk graph | **Delivered** |
| 2–11 | Scoring, AI analyst, underwriting, marketplace, syndication, capital ledger, claims, simulation, reinsurance, settlement, agent API | Specified, not built — `docs/roadmap.md` |

Phase 1 is built vertically: domain logic, migrations, API, authn/authz, audit
logging, error handling, docs and a passing test suite.

## Quick start

```bash
npm install
cp .env.example .env

# PostgreSQL, Redis and MinIO
docker compose -f infrastructure/docker/docker-compose.yml up -d

npm run db:generate
npm -w @neo-lloyds/database run migrate
npm -w @neo-lloyds/api run seed      # prints a root credential — store it
npm -w @neo-lloyds/api run build && npm -w @neo-lloyds/api start
```

API on `:3001`, OpenAPI at `/docs`.

```bash
npm test        # 65 tests
npm run typecheck
npm run lint
```

## The MVP scenario

A logistics company's shipment depends on a vessel, which depends on the Port
of Durban. A second exporter depends on the same port. The seed builds that
graph; the API then answers:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  localhost:3001/graph/entities/$ENTITY/what-can-fail    # Q1
curl -H "Authorization: Bearer $TOKEN" \
  localhost:3001/graph/risks/$RISK/picture               # Q3–Q6
curl -H "Authorization: Bearer $TOKEN" \
  localhost:3001/graph/entities/$ENTITY/correlations     # Q7
```

`picture` returns who is exposed (including *indirectly*, through the shared
port), what losses could result, which policies respond, and which capital
bears it. `correlations` surfaces the second exporter — the shared dependency
that concentration limits and, later, catastrophe modelling are built on.

## Layout

```
apps/api              NestJS API — identity, ontology and risk-graph modules
packages/domain       Pure domain core: ontology, graph, money, uncertainty, authz
packages/database     Prisma schema and migrations
infrastructure/docker Local stack
docs/                 Architecture, domain model, security model, roadmap, ADRs
```

`packages/domain` has **zero runtime dependencies**. Every risk calculation,
ontology rule and authorisation check is a pure function over plain data, so
results are reproducible and testable without infrastructure — see
`docs/decisions/0001-typescript-monorepo.md`.

## Principles enforced in code, not just documented

- **Provenance is mandatory.** A node or edge cannot exist without a source,
  timestamps and a confidence. AI-derived values are `AI_INFERRED` claims that
  must cite a model id, version and the source data they referenced — and are
  never treated as verified facts. Traversals take a `verifiedOnly` filter.
- **No false precision.** Estimates always carry confidence; the domain exposes
  no function returning a naked probability or loss figure.
- **Exact money.** Integer minor units with an ISO-4217 currency. Allocation
  across participants never loses or invents a unit.
- **The ontology is data.** Edge legality is a table, and it is the same table
  published at `GET /ontology`. Illegal endpoint pairs and `DEPENDS_ON` cycles
  are rejected on write.
- **Append-only audit.** Enforced by a database trigger, not by convention.
- **Agents act under a principal.** An `AI_AGENT` organisation requires a
  responsible principal, agents cannot be principals of other agents, and every
  agent action is checked against a bounded, expiring mandate through the same
  guard humans use.
- **Every response is stamped** with the simulation notice, centrally, so no
  endpoint can omit it.

## Documentation

- `docs/neo-lloyds-architecture.md` — architecture and tradeoffs
- `docs/domain-model.md` — entities, roles, ontology, the seven graph questions
- `docs/security-model.md` — authn, authz, agent constraints, audit, known gaps
- `docs/roadmap.md` — phase plan
- `docs/api/phase-1.md` — endpoint reference
- `docs/decisions/` — ADRs 0001–0006
- `docs/reports/phase-1.md` — implementation report
