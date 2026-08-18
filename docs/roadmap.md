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

## Phase 4 — Marketplace — **DELIVERED**

- `RiskSubmission`, `UnderwritingAssessment` and `UnderwritingApproval` moved
  from in-memory maps to Prisma tables — the trigger for this was listing
  needing to read them back after a restart, exactly as planned.
- `matchesAppetite()`: deterministic, explicit-reasons matching between a
  listing and a capital provider's declared appetite (risk classes, max
  exposure, jurisdictions, minimum return, max duration, tolerance,
  concentration limit).
- Listing re-checks underwriting clearance at listing time, not cached.
  Expressions of interest are explicitly non-binding — Phase 5 is where a
  real, invariant-bound allocation gets created.
- See `docs/reports/phase-4.md` for the restart test: full workflow exercised,
  server killed and restarted, everything confirmed still present.

## Phase 5 — Syndication — **DELIVERED**

- `proposeAllocation` / `removeAllocation`: pre-binding proposals, enforced
  only against a prospective 100% ceiling. `bindAllocations`: the one pure
  function where the crossing to a binding commitment happens, requiring an
  exact 100% total and recomputing amounts with the same exact-sum money
  split used everywhere else in the codebase (ADR-0005).
- `SyndicationService.bind` persists that crossing atomically, flips the
  syndication to BOUND, and marks the listing MATCHED. Two Postgres
  triggers — one making the allocation history append-only forever, one
  freezing `SyndicationAllocation` rows once BOUND — enforce the same
  invariant independent of the application code.
- Proposing an allocation requires a live `CapitalInterest` from Phase 4,
  which is the concrete point that interest stops being purely displayed.
- See `docs/reports/phase-5.md` for the exact line between non-binding and
  binding, stated in code, and for the verification order used: the
  database triggers were proven with raw SQL *before* any service code was
  written against them.

## Phase 6 — Capital Ledger — **DELIVERED**

- `computePosition`: committed / allocated (BOUND) / reserved (OPEN) /
  available / utilisation, computed live from every `SyndicationAllocation`
  a provider holds across every syndication — never a separately maintained
  running total that could drift.
- `requireCapacityForProposal`: the cross-syndication enforcement point,
  wired into `SyndicationService.propose` immediately after Phase 5's
  per-listing exposure check. A provider must declare a committed-capital
  ceiling before proposing anything at all (`422 NO_CAPITAL_COMMITMENT`).
- `concentrationBy`: risk class, jurisdiction, counterparty. Industry, event
  and asset concentration are not yet computable — the risk graph doesn't
  carry those as structured fields on a listing yet, stated as a real gap in
  `docs/reports/phase-6.md`, not worked around with fabricated data.
- Verified live with the scenario the phase exists to catch: two listings,
  each individually within a provider's per-listing appetite, together
  exceeding its total committed capital — caught only by this phase's check.

## Phase 7 — Claims — **DELIVERED**

- `requireCoverage`: the coverage test. A claim may only be filed against a
  BOUND syndication, and the claimed loss — plus every prior APPROVED or
  SETTLED claim already recorded against the same syndication, not just this
  one — must never exceed the capacity that was bound.
- `classifyReview` + `requireClaimApprovalIfNeeded`: AUTO below a
  configurable threshold, mandatory HUMAN_REVIEW above it, mirroring the
  underwriting approval gate from Phase 3.
- `computeClaimPayouts`: divides an approved loss across bound allocations
  using the same exact-sum split that binding itself uses (ADR-0005).
- Parametric triggers remain out of scope, deliberately: they are
  event-verified payments against a data feed, not a loss calculated from
  evidence, and the brief requires them to stay a separate engine.
- See `docs/reports/phase-7.md` for a live two-claim scenario proving the
  running-total check, and for a real bug the e2e suite caught (a rejection
  decision was tripping the check meant to guard approvals) before it shipped.

## Phase 8 — Simulation & Digital Twin — **DELIVERED**

Port closure, supply-chain disruption, commodity shock, weather, infrastructure
failure, counterparty failure, geopolitical, cyber. Outputs exposed entities,
affected assets, estimated loss, correlated exposure, capital requirement,
insured vs uninsured. The core differentiator, and the first phase that runs
*forward* from the risk graph rather than processing something that already
happened.

- `runSimulation` (`packages/domain/src/simulation.ts`) is built entirely on
  Phase 1's existing pure query functions (`dependentsOf`, `exposedEntities`,
  `correlatedEntities`, `coveringPolicies`, `capitalBearingRisk`) — no second
  graph-traversal implementation, so a simulation can never disagree with the
  graph about what depends on what.
- The estimated-loss figure is deliberately low-confidence
  (`confidence: 0.2`, `basis: 'INSUFFICIENT_DATA'`, always): there is no
  actuarial model behind it, by design, until real peril-specific damage
  functions and loss history exist. See `docs/reports/phase-8.md`.
- Insured-vs-uninsured resolution is risk-level, not entity-level — a
  documented ontology gap (no `POLICY -> ENTITY` edge exists yet), not a
  fabricated per-entity link.
- See `docs/reports/phase-8.md` for a live run against the seeded MVP
  shipment scenario, verified end to end against PostgreSQL.

## Phase 9 — Reinsurance — **DELIVERED**

Configurable layers, quota share, excess of loss, aggregate protection — as
software abstractions, not regulated contracts.

- `applyReinsuranceProgram` (`packages/domain/src/reinsurance.ts`) runs a
  gross loss through a program's layers in order, each layer receiving the
  prior layer's retained remainder. `totalCeded + netRetained` always equals
  the gross loss exactly, same invariant discipline as `allocateMoney`
  (ADR-0005).
- Stated plainly, not modelled around: real placements do not always stack
  layers serially the way this does, and no reinsurer counterparty is
  modelled — a program is the cedant's own configuration, not a bilateral
  contract. See `docs/reports/phase-9.md`.
- `AGGREGATE` layers carry running consumed-gross/consumed-ceded state
  forward between cessions, persisted per layer — verified live with a
  two-cession run proving the second cession correctly saw what the first
  one had already consumed of the attachment/limit.

## Phase 10 — Settlement — **DELIVERED**

`SettlementProvider` interface with bank / digital-money / stablecoin adapters.
No cryptocurrency hard-coded. Full transaction record and audit for every
operation. Configurable fee engine.

- This is where Phase 7's claims "settled" status — a bare state-machine
  flag, no money moving — gets real transaction infrastructure: a
  `SettlementTransaction` record, a fee calculation
  (`fee + netAmount = grossAmount`, exactly), and a `SettlementProvider`
  call.
- Exactly one honest provider implementation exists today —
  `NullSettlementProvider`, which simulates instant success and stamps an
  unmistakably fake reference (`sim-bank_transfer-<id>`) — because no real
  bank/digital-money/stablecoin integration exists yet. Same discipline as
  the AI analyst provider and the SSO gap: an honest simulation beats a fake
  real one. See `docs/reports/phase-10.md`.

## Phase 11 — AI Agent API — **DELIVERED**

Authenticate → submit activity → request assessment → indicative protection →
coverage options → human approval where required → permitted execution →
settlement information. Mandate enforcement throughout.

- Every step delegates to the existing service a human caller uses for the
  same action — this phase adds no parallel logic. What it adds is the
  first live call to `assertAgentMayAct` (built and unit-tested since Phase
  1, never wired into a request path until now): mandate existence,
  principal resolution and active/KYB status, expiry, permitted action, and
  transaction ceiling, all enforced before the underlying service runs.
- `assertAgentMayAct` is a documented no-op for non-agent callers, so every
  `/agent/*` route also works for a human/service credential with no
  mandate gate in the way — there is no separate agent path
  (security-model.md §4).
- Verified live: a mandate with a $500 ceiling correctly rejected a $600
  execution attempt with `403`, confirmed to happen *before* the target
  listing was even looked up. See `docs/reports/phase-11.md`.

## Continuous
Jurisdiction modules (ZA first, then UK/EU/US), portals (broker, capital,
corporate, admin), observability, and the security gaps listed in
`docs/security-model.md` §8.
