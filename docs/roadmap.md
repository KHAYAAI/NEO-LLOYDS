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

## Phase 2 — Risk Submission + Risk Scoring + AI Analyst — **DELIVERED**

- `DRAFT → SUBMITTED → ANALYSING → SCORED → READY_FOR_UNDERWRITING` state
  machine, forward-only.
- Deterministic scoring engine producing probability, severity, expected loss,
  correlation, concentration and mitigation — each an `Estimate`/`RangeEstimate`
  with explicit confidence and basis. Reproducible: same input, same output.
- AI analyst as a strictly *advisory* adapter (no method that approves, prices
  or binds). Every finding cites source data, model id, model version,
  timestamp, confidence, enforced by `analystFinding()`. Provider abstraction
  with a null/degraded default and an Anthropic adapter.
- See `docs/reports/phase-2.md` for the one external dependency this phase
  introduces (`ANTHROPIC_API_KEY`, optional) and what it does *not* yet
  depend on (calibrated actuarial data — flagged for before production use).

## Phase 3 — Underwriting — **DELIVERED**

- `assessUnderwriting()`: eligibility, band, suggested premium range, capital
  requirement, suggested capacity, exclusions, conditions, required evidence.
- Configurable `ApprovalThresholds`; `classifyBand()` maps a `RiskScore` onto
  `LOW/MEDIUM/HIGH/EXTREME`.
- `requireApprovalIfNeeded()` is the enforcement point: no automated path can
  treat a MEDIUM+ assessment as cleared without a recorded, matching, approved
  `UnderwritingApproval` — checked and gated behind the `UNDERWRITER` role.
- See `docs/reports/phase-3.md` for a real bug the test suite caught before
  shipping (automation eligibility was gated on the wrong confidence figure),
  and what remains a data/expertise dependency rather than a code one
  (uncalibrated thresholds).

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
