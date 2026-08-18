# Neo-Lloyds — Architecture

> **SIMULATION / TEST ENVIRONMENT — NOT INSURANCE.**
> Neo-Lloyds is a technology prototype. It is not an insurer, not a licensed
> financial services provider, and nothing it produces is a legally binding
> contract of insurance, financial advice, or a regulated offer.

## 1. What this system is

Neo-Lloyds is **risk-capital infrastructure**, not an insurance company. Its job is
to make economic risk *measurable, priceable, transferable and financeable* by
machines as well as humans.

The platform separates concerns that a conventional insurer collapses into one
entity:

| Concern | Owner in the model |
|---|---|
| Originating risk | Risk Originator (company, AI agent) |
| Intermediating risk | Broker |
| Assessing/pricing risk | Underwriting entity |
| Bearing risk | Syndicate |
| Funding risk-bearing | Capital Provider |
| Protecting the bearer | Reinsurer |
| Adjudicating loss | Claims Administrator |
| Moving money | Settlement Provider |
| Constraining all of it | Governance / Regulator |

**No object in the domain model may play two of these roles implicitly.** An
organisation may *hold* several roles, but each role is an explicit, separately
authorised grant (see `docs/domain-model.md` §2).

## 2. Architectural shape

A **TypeScript monorepo**, modular-monolith-first. Services are compiled as
independent NestJS modules inside one deployable API, behind clean package
boundaries, so any module can be extracted into its own process later without a
domain rewrite.

```
                        clients / AI agents
                                │
                         ┌──────┴──────┐
                         │  apps/api   │  NestJS, HTTP + OpenAPI
                         └──────┬──────┘
        ┌──────────────┬────────┼────────┬──────────────┐
   identity       risk-graph  underwriting  marketplace  … (later phases)
        └──────────────┴────────┼────────┴──────────────┘
                    packages/domain  (pure, dependency-free)
                                │
                    packages/database (Prisma → PostgreSQL)
```

### Why modular monolith and not microservices

The spec lists eleven services. Deploying eleven processes on day one would buy
independent scaling we do not need and cost us distributed transactions across
*capital allocation*, *syndication* and *settlement* — precisely the places where
correctness matters most. We keep the **module boundaries** (which are the
expensive thing to get right) and defer the **process boundaries** (which are
cheap to introduce later). ADR-0002.

### Layering rule

`packages/domain` has **zero runtime dependencies** — no Nest, no Prisma, no I/O.
All risk mathematics, graph traversal, allocation invariants and role checks live
there as pure functions over plain data. This is what makes every financial
calculation reproducible (non-negotiable principle #8): the same inputs always
produce the same outputs, and a test can prove it without a database.

Persistence, HTTP and AI providers are adapters around that core.

## 3. Phase 1 scope (this implementation)

Delivered:

- **Identity** — organisations, roles, users, API credentials, RBAC, audit log.
- **Risk ontology** — the canonical node/edge vocabulary, machine-readable.
- **Risk graph** — typed graph with validated edges and the six traversal
  queries the spec requires.

Deliberately *not* delivered yet: scoring, AI analyst, underwriting, marketplace,
syndication, capital ledger, claims, simulation, reinsurance, settlement, agent
API. See `docs/roadmap.md`. The Prisma schema in this phase covers identity and
graph only; later phases add their own migrations rather than pre-building tables
we cannot yet exercise.

## 4. Cross-cutting invariants

**Provenance.** Every fact that enters the graph carries `source`, `observedAt`,
`recordedAt`, `confidence` and a transformation chain. A value with no provenance
is not a fact; the ontology has no way to express one. AI output is a *claim*
with a model id and version attached — never a fact.

**Uncertainty.** Numeric risk outputs are intervals or point-estimates paired with
an explicit confidence. `packages/domain` exposes no API that returns a bare
probability. False precision is a correctness bug, not a presentation issue.

**Audit.** Every state transition records actor, timestamp, action, subject,
before/after and reason. Audit records are append-only.

**Human control.** AI is advisory by default. No code path may bind a
risk-transfer obligation without a recorded human approval at the threshold
required by the governance policy in force.

## 5. Technology

Next.js + Tailwind (web, later phases) · NestJS (API) · PostgreSQL + Prisma ·
Redis/BullMQ (queues, later) · S3-compatible object storage (evidence, later) ·
OpenTelemetry + structured logging · Docker Compose local, Kubernetes-ready.

Graph data lives in PostgreSQL using adjacency tables plus recursive CTEs. No
separate graph database until traversal depth or fan-out demonstrably outgrows
it — ADR-0003.

## 6. Jurisdiction

The core domain is jurisdiction-neutral. Jurisdiction-specific rules (capital
treatment, KYC/AML, sanctions, tax, data residency, cross-border) load as modules
in `packages/config`. South Africa is the first module because
the strategic HQ is Johannesburg — it is *not* the default and no South African
assumption may be hard-coded into the core. ADR-0004.

**Delivered:** ZA, GB, EU, US, RU, CN, SG, HK — published at
`GET /jurisdictions`. Every module is an illustrative regulatory summary
(real regulator names and regime shape; placeholder numeric/graded
judgements), not legal advice — see `docs/reports/jurisdiction-modules.md`.

## 7. Tradeoffs taken

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Service topology | Modular monolith | 11 microservices | Transactional integrity across capital/syndication; extract later |
| Graph storage | PostgreSQL + CTEs | Neo4j / AGE | One source of truth; graph is small and mostly tree-shaped at MVP |
| Money | Integer minor units + currency | Floats / Decimal strings | Exact arithmetic; no float drift in ledgers |
| Domain purity | Zero-dep domain package | Anaemic model + services | Reproducibility and testability without infrastructure |
| Auth | API key + scoped RBAC | Full OIDC now | KYB/OIDC-ready interfaces, but not blocking Phase 1 |
| Events | In-process bus | Kafka | Spec forbids premature Kafka; interface allows swap |
