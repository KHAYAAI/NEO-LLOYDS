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

## Status: Phases 1–11 delivered

| Phase | Scope | State |
|---|---|---|
| 1 | Identity · Risk ontology · Risk graph | **Delivered** |
| 2 | Risk submission · Deterministic scoring · AI analyst | **Delivered** |
| 3 | Underwriting: assessment, approval bands, human-approval gate | **Delivered** |
| 4 | Marketplace: listings, capital appetite, matching, interest — submissions and underwriting now durable | **Delivered** |
| 5 | Syndication: allocations summing to exactly 100%, immutable history, binding enforced by database trigger | **Delivered** |
| 6 | Capital ledger: committed/allocated/reserved/available capital and concentration, computed live across every syndication a provider holds | **Delivered** |
| 7 | Claims: incident → evidence → verification → coverage test → loss → review → approval → settlement, with a running-total check across every claim on a syndication | **Delivered** |
| 8 | Simulation & Digital Twin: runs a scenario forward from the risk graph — affected assets, exposed entities, estimated loss, correlated exposure, capital requirement, insured vs uninsured | **Delivered** |
| 9 | Reinsurance: configurable quota share / excess of loss / aggregate layers over a cedant's own retained loss, as software abstractions, not regulated contracts | **Delivered** |
| 10 | Settlement: `SettlementProvider` interface, fee engine, full transaction record — real infrastructure behind Phase 7's "settled" flag | **Delivered** |
| 11 | AI Agent API: authenticate → activity → assessment → indicative protection → coverage options → approval → permitted execution → settlement info, with a real mandate check on every step | **Delivered** |

All eleven numbered phases from `docs/roadmap.md` are now built. Of the
roadmap's non-phase-gated "Continuous" section: **jurisdiction modules are
delivered** for South Africa (first, ADR-0004), the United Kingdom, the
European Union, the United States, Russia, China, Singapore, and Hong Kong
(`packages/config`, published at `GET /jurisdictions`) — see
`docs/reports/jurisdiction-modules.md`. **All four portals are delivered**
(`apps/broker-portal`, `apps/capital-portal`, `apps/corporate-portal`,
`apps/admin-portal`, `apps/claims-admin-portal`) — the first user-facing
UIs and the first frontend-stack decision in this repository (Next.js App
Router + React + TypeScript throughout, credential handling entirely
server-side, no separate login system in any of them). Broker covers
submit → advance → AI analyst findings → score → underwriting clearance →
list to marketplace; capital provider covers browsing listings/expressing
interest, setting appetite with ranked matches, and viewing
exposure/concentration; corporate covers reporting a claim, attaching
evidence, and viewing payouts; admin covers organisation/role/credential
management, the audit log, and the jurisdiction-module browser;
claims-administrator covers the actions the API has had since Phase 7 but
no UI exposed until now — advance/loss-calculate/decide/settle. Every
portal verified live with a real browser driving the actual running API
and PostgreSQL — not a mock — which caught genuine bugs (a Next.js
`redirect()`-inside-`try/catch` gotcha, a `'use server'` export-shape
restriction, a login-validation endpoint that legitimately 404s for a
valid but not-yet-onboarded credential) that typecheck and lint alone
would have missed. Mandate management is not built into any portal yet.

**Launch-readiness infrastructure**, per `docs/security-model.md` §8:
a GitHub Actions CI pipeline (`.github/workflows/ci.yml`) now gates every
push/PR on the full test suite, typecheck, and lint (previously only
verified by hand), plus a `next build` per portal. An OIDC authenticator
is real and tested (`apps/api/src/common/oidc.ts`,
`apps/api/test/oidc-auth.test.ts`) — genuine JWT signature/issuer/
audience/expiry verification via `jose`, alongside the original API-key
credential path — see `docs/security-model.md` §10 for exactly what that
does and doesn't close (no registered real-world identity provider, no
browser login flow yet). Everything else in §8 — real KYB/KYC, sanctions
screening, an HSM/secrets manager, a penetration test, a real reinsurer
counterparty, real settlement, and regulatory licensing — remains an
external integration or legal/business process, not something addable by
more code alone; §8 explains why for each.

Each phase is built vertically: domain logic, migrations where applicable,
API, authn/authz, audit logging, error handling, docs and a passing test
suite. See `docs/reports/phase-2.md` through `docs/reports/phase-11.md` for
what each phase depends on externally before it can inform a real decision.
Phase 4's report proves durability (a full workflow, a server restart,
confirmation everything survived). Phase 5's report states, precisely, the
one function and one API call where the system crosses from non-binding
interest to a binding capital commitment. Phase 6's report walks through a
scenario built specifically to be invisible to every check that existed
before it: a provider spread thin across two separate listings, each
individually within its per-listing appetite, caught only once its total
committed capital is computed across both at once. Phase 7's report is the
first place a bound allocation is tested against a real number: a claim
checked not just against the syndication's total capacity but against every
prior claim already recorded against it. Phase 8's report is the first phase
that runs forward instead of backward — "what would this event do to what's
insured here" — and is explicit that its loss estimate is a deliberately
low-confidence placeholder, not an actuarial model. Phase 9's report is
explicit that no reinsurer counterparty is modelled yet — a program is the
cedant's own configuration for how a loss would split, not a bilateral
contract — and proves an aggregate layer's running state genuinely persists
across separate cessions, verified by querying the database directly between
two live calls. Phase 10's report is explicit that only one honest
settlement provider exists — a Null provider that simulates instant success
with an unmistakably fake reference — because no real bank, digital-money,
or stablecoin integration is wired up yet; its live run confirms a fee
computed to the cent and every field of the resulting transaction verified
directly against PostgreSQL. Phase 11's report is explicit that it adds no
new domain logic at all — every step delegates to an existing service — and
that its entire contribution is the first live call to a mandate-enforcement
function (`assertAgentMayAct`) that has existed, unit-tested but never wired
into a request path, since Phase 1; its live run proves a $600 execution
attempt against a $500 mandate ceiling is rejected before the target listing
is even looked up.

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
npm test        # 286 tests
npm run typecheck
npm run lint
```

To exercise the AI analyst against a real model instead of the null
fallback, set `ANTHROPIC_API_KEY` before starting the API — see
`docs/reports/phase-2.md` for what happens with and without it.

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
- `docs/api/reference.md` — endpoint reference
- `docs/decisions/` — ADRs 0001–0006
- `docs/reports/phase-1.md` — implementation report
