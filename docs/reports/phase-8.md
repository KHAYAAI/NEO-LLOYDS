# Phase 8 — Implementation Report

> SIMULATION / TEST ENVIRONMENT — NOT INSURANCE.

**Scope:** Simulation & Digital Twin — runs a named scenario forward from an
organisation's risk graph and answers "what would this event do to what's
insured here": affected assets, exposed entities, an estimated loss,
correlated exposure, capital requirement, and an insured-vs-uninsured split.
**Status:** Delivered and verified against PostgreSQL, including a live
run of the seeded MVP shipment scenario end to end.

## The direction change

Every phase through 7 processes something that already happened — a
submission, an assessment, a claim — and answers questions about the graph as
it stands today (Phase 1's seven queries). Phase 8 is the first to run
*forward*: given a hypothetical trigger event, what does the graph say would
be affected if it happened. This is built deliberately as composition, not a
second traversal engine: `runSimulation`
(`packages/domain/src/simulation.ts`) calls straight into Phase 1's existing
pure query functions — `dependentsOf`, `exposedEntities`,
`correlatedEntities`, `coveringPolicies`, `capitalBearingRisk` — so a
simulation result can never disagree with the graph about what depends on
what. Nothing in `simulation.ts` walks an edge itself.

## What a scenario is

```
SimulationScenario {
  kind: PORT_CLOSURE | SUPPLY_CHAIN_DISRUPTION | COMMODITY_SHOCK | WEATHER |
        INFRASTRUCTURE_FAILURE | COUNTERPARTY_FAILURE | GEOPOLITICAL | CYBER
  triggerNodeId: string   // the ASSET or RISK node the scenario originates at
  durationDays: number    // > 0
  severity: number        // [0, 1]
  description?: string
}
```

Every parameter is an explicit input. There are no hidden defaults for
duration or severity — the entire point of a "what if" tool is that the "if"
is stated, not assumed. `requireValidScenario` rejects an unknown kind,
non-positive duration, or out-of-range severity before anything runs.

## The honesty point: `estimateLoss`

This is the one place in the whole system most likely to be misread as more
certain than it is, so it gets stated plainly, in the code and here.
**There is no actuarial model behind the estimated-loss figure.** No
peril-specific damage function, no historical claims data, no
dependency-weighted cascading-failure simulation. The formula is:

```
(placeholder per-asset magnitude) × (affected asset count) × severity ×
(scenario weight) × log2(1 + durationDays)
```

`confidence` is pinned at `0.2` and `basis` is always `'INSUFFICIENT_DATA'`,
regardless of the inputs — no combination of scenario parameters is allowed
to present this number as more certain than it is. The scenario-kind weights
(cyber cascades faster per asset than weather, etc.) are illustrative
judgement calls, not derived from loss history, and are commented as such at
the point of definition. A real deployment needs calibrated peril models per
asset class and jurisdiction; that is a stated gap, not something to work
around with fabricated confidence.

## A second honesty point: insured-vs-uninsured is risk-level, not entity-level

The ontology (`packages/domain/src/ontology.ts`) has no edge connecting a
`POLICY`/`COVERAGE` node to the specific `ENTITY` it insures — `COVERS` only
reaches from a policy to a `RISK`, and there is no modelled
"holds-a-policy" relationship from an entity. So `coveredEntityIdsForRisk`
does the most honest thing available: if any policy covers the relevant risk
at all, every entity exposed to that risk is treated as insured; otherwise
none are. This will over-count coverage whenever a policy exists but does not
actually name every exposed entity as a policyholder. Flagged here rather
than worked around with a fabricated per-entity link the graph does not
actually carry — closing this properly is graph-ontology work (a
`POLICY -INSURES-> ENTITY` edge type), not a simulation-layer fix.

## What was built

**`packages/domain/src/simulation.ts`** (pure, zero dependencies):
- `SIMULATION_SCENARIO_KINDS` / `isSimulationScenarioKind` / `requireValidScenario`
- `runSimulation(graph, scenario, currency) → SimulationResult` — the forward
  run described above.
- `estimateLoss` — the deliberately low-confidence loss model.
- `coveredEntityIdsForRisk` — the risk-level insured/uninsured resolver.
- `sumEstimatedLosses` — a reporting helper across several runs' estimates,
  summed via the existing `sumMoney` (integer minor units throughout; no
  floats in any money figure).

14 unit tests in `packages/domain/test/simulation.test.ts`, using the same
`shipmentGraph()` fixture Phase 1's `queries.test.ts` uses, covering: affected
assets/exposed entities for an ASSET trigger, loss-estimate confidence and
scaling with severity, correlated exposure, the insured/uninsured split with
and without covering policy, an ENTITY-trigger edge case (documented as
producing no affected assets — only ASSET/RISK triggers resolve them),
unknown-node/unknown-kind/invalid-duration/invalid-severity rejections.

**`packages/database`** — one migration (`0008_simulation`): `SimulationRun`
(scenario inputs plus the full `SimulationResult` stored as JSON — a
read-mostly analytical snapshot, not a record anything else joins against
transactionally, so it was not normalised across half a dozen tables the way
`Claim`/`ClaimPayout` are).

**`apps/api/src/simulation`** — `POST /simulation` (run a scenario against a
trigger node's organisation graph, persist the result, audit it),
`GET /simulation/:id`, `GET /simulation` (list, most recent first). Tenant
isolation follows the trigger node's owning organisation, exactly like
`GraphService`. `RISK_ORIGINATOR`, `BROKER`, `SYNDICATE`, and
`CLAIMS_ADMINISTRATOR` may all run a scenario — this is read-only analysis
against a graph the caller already has read access to, not a binding action,
so the role gate is deliberately broader than Phase 3's underwriter-only
approval gate.

`SimulationRepository` port + `InMemorySimulationRepository` (tests) +
`PrismaSimulationRepository` (production), wired into `app.module.ts` in
both `withPersistence()` and `forRoot()`, following the exact pattern every
prior phase used.

8 new e2e tests in `apps/api/test/api.e2e.test.ts`: a full run against the
Phase-1-style fixture graph asserting every output field, all eight scenario
kinds run without error, retrieval by id, listing, validation rejection
(unknown kind, out-of-range severity), missing-credential rejection, and
unknown-trigger-node 404.

## Verification

| Check | Result |
|---|---|
| `npm test` | 208 passed (186 before this phase → +14 domain, +8 API e2e) |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| One new migration (`0008_simulation`) | applied |
| Live API on PostgreSQL | full run against the seeded MVP shipment graph |

**The live run**, against the existing seed script's Durban port-closure
scenario (`apps/api/src/seed/seed.ts`) with no changes needed to the seed
data: `POST /simulation` with `kind: PORT_CLOSURE`, `triggerNodeId` = the
seeded Port of Durban asset, `durationDays: 3`, `severity: 0.8`. Confirmed
live:
- **4 affected assets** correctly resolved by walking `DEPENDS_ON` in
  reverse from the port (`MV Agulhas`, `Shipment HP-1190`, the reefer
  shipment, and the citrus cargo depending on the shipment).
- **2 exposed entities** (`Kalahari Logistics`, `Highveld Produce Exports`) —
  the owners of those affected assets, including the neighbouring shipper
  whose exposure only exists because it shares the same port dependency.
- **estimatedLoss** returned with `confidence: 0.2` and
  `basis: "INSUFFICIENT_DATA"` — never presented as a priced figure.
- **capitalRequirement** correctly identified `Syndicate Alpha` and its
  backing `Fund I` capital.
- **correlatedExposure** correctly found both entities correlated through
  their shared port dependency (Q7 reused unmodified).
- **insuredVsUninsured**: both entities marked insured, because the seeded
  marine cargo policy covers the port-closure risk they are both exposed to
  — exactly the risk-level (not entity-level) resolution documented above.
- The run was then **retrieved by id** (`GET /simulation/:id`) and appeared
  in the **organisation's run list** (`GET /simulation`), confirming the
  Postgres round-trip, not just the in-request response.
- `POST /simulation` without a credential returned `401`, confirming the
  auth guard applies to the new route exactly like every other mutating
  endpoint.

## What "the core differentiator" delivers today, precisely

A caller can ask "if this port/asset/counterparty fails, what breaks, who's
exposed, roughly how bad, and are they even covered" and get a graph-grounded
answer today, persisted and auditable. What it does **not** yet do: no
peril-calibrated loss curves (stated above), no entity-level coverage
resolution (stated above), no cascading second-order failure (a scenario
does not currently trigger a *further* scenario from an affected asset — the
DEPENDS_ON closure is one traversal, not an iterative cascade), and no time
dimension to a scenario beyond `durationDays` feeding the loss model — there
is no "what does day 3 look like versus day 30" progression. These are
genuine directions for Phase 8 to deepen, not blockers to using the current
version as a directional exposure-mapping tool.

## External dependencies this phase introduces

None. No new paid or licensed service.

## Known gaps carried forward

Unchanged from `docs/security-model.md` §8/§9/§10: no OIDC/SSO, no real
KYB/KYC, no sanctions screening, no HSM, no secrets manager, no penetration
test. (Rate limiting, security headers, CORS allow-listing, request-size
limits and failed-auth logging were closed in the hardening pass that
preceded this phase — see `docs/security-model.md` §9.)

## Next

Phase 9 — Reinsurance.
