# Neo-Lloyds — Roadmap

> SIMULATION / TEST ENVIRONMENT — NOT INSURANCE.

Each phase is vertical: domain logic, persistence, API, tests, authz, audit,
docs. A phase is not "done" until it meets the Definition of Done (§34 of the
brief) — code, migrations, API, tests, authn/authz, audit, error handling,
documentation, local deployment, passing tests.

## Phase 1 — Identity + Risk Ontology + Risk Graph — **DELIVERED**

- Organisations, market roles, users, API credentials, RBAC, audit log.
- Machine-readable ontology: 16 node types, 11 edge rules, provenance model.
- Typed risk graph with validated edges, cycle prevention, and the traversal
  queries answering the six graph questions.
- Prisma schema + initial migration; Docker Compose; test suite.

## Phase 2 — Risk Submission + Risk Scoring + AI Analyst
Risk package submission from a broker/originator; deterministic scoring engine
producing probability, severity, expected loss, MEL, duration, correlation,
concentration and mitigation — each with explicit confidence. AI analyst as an
*advisory* adapter: every conclusion carries source data, model id, model
version, timestamp, confidence. Provider abstraction over multiple LLMs.

## Phase 3 — Underwriting
Risk package → underwriting assessment (eligible, score, expected loss, premium
*range*, capital requirement, capacity, exclusions, conditions, required
evidence, model confidence). Configurable approval thresholds with human review
queues.

## Phase 4 — Marketplace
Listings, capital-provider appetite (risk classes, max exposure, geography,
minimum return, duration, tolerance, concentration limits), matching, interest.

## Phase 5 — Syndication
Allocation across providers with hard invariants: total = 100%, no
over-allocation, no duplicate capacity, no exposure-limit breach. Immutable
allocation history.

## Phase 6 — Capital Ledger
Committed / available / allocated / reserved / exposed / released capital,
claims and recoveries. Concentration by geography, industry, risk class,
counterparty, event, asset. Integer minor units throughout.

## Phase 7 — Claims
Incident → evidence → verification → policy match → coverage check → loss
calculation → review → approval → settlement → audit. Parametric triggers kept
in a separate engine from indemnity adjudication.

## Phase 8 — Simulation & Digital Twin
Port closure, supply-chain disruption, commodity shock, weather, infrastructure
failure, counterparty failure, geopolitical, cyber. Outputs exposed entities,
affected assets, estimated loss, correlated exposure, capital requirement,
insured vs uninsured. The core differentiator.

## Phase 9 — Reinsurance
Configurable layers, quota share, excess of loss, aggregate protection — as
software abstractions, not regulated contracts.

## Phase 10 — Settlement
`SettlementProvider` interface with bank / digital-money / stablecoin adapters.
No cryptocurrency hard-coded. Full transaction record and audit for every
operation. Configurable fee engine.

## Phase 11 — AI Agent API
Authenticate → submit activity → request assessment → indicative protection →
coverage options → human approval where required → permitted execution →
settlement information. Mandate enforcement throughout.

## Continuous
Jurisdiction modules (ZA first, then UK/EU/US), portals (broker, capital,
corporate, admin), observability, and the security gaps listed in
`docs/security-model.md` §8.
