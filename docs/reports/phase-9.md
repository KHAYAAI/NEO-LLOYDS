# Phase 9 — Implementation Report

> SIMULATION / TEST ENVIRONMENT — NOT INSURANCE.

**Scope:** Reinsurance — configurable layers (quota share, excess of loss,
aggregate protection) over a cedant's own retained loss, as software
abstractions a program is configured with — not regulated reinsurance
contracts.
**Status:** Delivered and verified against PostgreSQL, including a live
multi-cession run proving aggregate-layer state carries forward correctly.

## What a program is, precisely

A `ReinsuranceProgram` belongs to a cedant organisation (one holding the
`SYNDICATE` market role — the same role that assumes risk in the graph) and
holds an ordered set of `ReinsuranceLayer`s. Each layer is one of three
kinds:

- **`QUOTA_SHARE`** — cedes a fixed proportion (`cededBps`) of every loss
  presented to it, optionally capped per loss (`perLossLimit`).
- **`EXCESS_OF_LOSS`** — cedes the slice of a single loss between an
  `attachmentPoint` and `attachmentPoint + limit`. Nothing below the
  attachment point cedes; nothing above the limit does either.
- **`AGGREGATE`** — cedes only once the *cumulative* total of losses this
  layer has processed crosses its attachment point, up to an aggregate
  limit for the program's whole period. This is the one layer kind that is
  not stateless per loss: it must carry `consumedGross`/`consumedCeded`
  forward between cessions.

`applyReinsuranceProgram` (`packages/domain/src/reinsurance.ts`) runs a
gross loss through a program's layers **in `order`**, each layer receiving
what the previous layer left retained — layer 1 sees the full gross loss,
layer 2 sees layer 1's retained remainder, and so on. `totalCeded +
netRetained` always equals the gross loss exactly (proven by property-style
tests, not just example ones), the same "the parts must sum to the whole"
discipline as `allocateMoney` (ADR-0005) and `computeClaimPayouts` (Phase 7).

## The honesty point: this is not how a real placement always works

Real reinsurance placements do not always stack layers serially on the
retained remainder — a quota share is often computed on the cedant's whole
gross book (premium and loss together), not chained in front of an excess-of-
loss tower the way this module does it. This module picks the simplest
coherent model — sequential layer application to a single loss — and states
that choice plainly rather than modelling a placement structure this system
has no real treaty data to calibrate against. It is the same discipline as
Phase 8's stated gap on peril-specific loss curves: a defensible software
abstraction, not a claim to model real market practice exactly.

A second, deliberate scope limit: **there is no reinsurer counterparty
modelled.** A program is configuration the cedant holds — there is no
`Organisation` on the other side of a cession, no acceptance, no
reinstatement premium, no reinsurer credit risk. "Reinsurance" here means
"the cedant's own math for how a loss would split if this program existed,"
not a bilateral contract with another party. Modelling an actual reinsurer
counterparty (their own `Organisation`, their own capital position, a
`PROTECTS` edge already sitting unused in the risk graph's ontology since
Phase 1 — see `capitalBearingRisk`'s `protection` field) is a real next step
this phase does not attempt.

## What was built

**`packages/domain/src/reinsurance.ts`** (pure, zero dependencies):
- `REINSURANCE_LAYER_KINDS` / `isReinsuranceLayerKind` / `requireValidLayerParams`
- `applyQuotaShare`, `applyExcessOfLoss`, `applyAggregate` — the three
  per-layer computations described above.
- `applyReinsuranceProgram` — the ordered-stacking composition.
- `isFullyCeded` — a small convenience predicate.

18 unit tests in `packages/domain/test/reinsurance.test.ts`: each layer kind
in isolation (including the aggregate layer's cross-call state threading),
layer stacking regardless of array insertion order (sorted by `order`, not
array position), the "ceded + retained always equals the loss" invariant
under fuzzed-looking odd amounts, and parameter validation rejections.

**`packages/database`** — one migration (`0009_reinsurance`):
`ReinsuranceProgram`, `ReinsuranceLayer` (holding each `AGGREGATE` layer's
running consumed totals as `BigInt` columns), `ReinsuranceCession` (one row
per cession, storing the full per-layer breakdown as JSON — the same
read-mostly-analytical-snapshot reasoning as `SimulationRun.result` in Phase
8).

**`apps/api/src/reinsurance`** — `POST /reinsurance/programs` (create,
`SYNDICATE`-only), `GET /reinsurance/programs/:id`, `GET /reinsurance/programs`
(list), `POST /reinsurance/programs/:id/cede` (**the cession
calculation** — runs a loss through the program, persists the split,
updates any `AGGREGATE` layers' running state, audits), `GET
/reinsurance/programs/:id/cessions`. A cession may optionally carry a
`claimId` for audit linkage to a Phase 7 claim, but nothing in this phase
automatically triggers a cession when a claim's loss is calculated — that
wiring (should a claim's approved loss automatically run through the
cedant's reinsurance program?) is a real design decision for a future phase,
not defaulted here.

`ReinsuranceRepository` port + `InMemoryReinsuranceRepository` (tests) +
`PrismaReinsuranceRepository` (production), wired into `app.module.ts` in
both `withPersistence()` and `forRoot()`.

10 new e2e tests in `apps/api/test/api.e2e.test.ts`: program creation with
stacked layers, a full cession with the exact expected split, aggregate
state carrying across two cessions on the same program, claim-id linkage,
listing, unknown-layer-kind and duplicate-order rejection, currency-mismatch
rejection, missing-credential rejection, and a non-`SYNDICATE` organisation
correctly forbidden from creating a program.

## Verification

| Check | Result |
|---|---|
| `npm test` | 236 passed (208 before this phase → +18 domain reinsurance tests, +10 net new API e2e tests) |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| One new migration (`0009_reinsurance`) | applied |
| Live API on PostgreSQL | program creation, a stacked-layer cession, and a two-cession aggregate-state run, all verified live |

**The live run**, against the freshly seeded database:
- Created a program with a **20% quota share** layer (order 1) and an
  **excess-of-loss** layer (order 2, attachment $100,000, limit $500,000).
  Ceded a $100,000 loss: quota share correctly ceded $20,000 (20%), leaving
  $80,000 retained; the excess-of-loss layer then saw that $80,000 —
  correctly below its $100,000 attachment — and ceded nothing. Total ceded
  $20,000, net retained $80,000, summing back to the original $100,000
  exactly.
- Created a second program with a single **aggregate** layer (attachment
  $1,000, limit $500). First cession of $600 correctly ceded **$0** (still
  below the $1,000 attachment). Second cession of $600 (cumulative $1,200)
  correctly ceded **$200** — exactly the portion of the cumulative total
  that crossed the attachment point. Queried the `ReinsuranceLayer` row
  directly in PostgreSQL afterward and confirmed
  `aggregateConsumedGrossMinor = 120000` / `aggregateConsumedCededMinor =
  20000` — the running state genuinely persisted and was read back
  correctly for the second cession's calculation, not recomputed from
  scratch or held only in memory.
- `GET /reinsurance/programs/:id/cessions` correctly listed both cessions.
- `POST /reinsurance/programs` without a credential returned `401`.

## External dependencies this phase introduces

None. No new paid or licensed service.

## Known gaps carried forward

Unchanged from `docs/security-model.md` §8/§9/§10: no OIDC/SSO, no real
KYB/KYC, no sanctions screening, no HSM, no secrets manager, no penetration
test. Phase-9-specific gaps stated above: no modelled reinsurer
counterparty, no reinstatement premiums, sequential (not necessarily
market-accurate) layer stacking, and no automatic claim-to-cession wiring.

## Next

Phase 10 — Settlement: a `SettlementProvider` interface with bank /
digital-money / stablecoin adapters, full transaction record and audit for
every operation, configurable fee engine. This is where Phase 7's claims
"settled" status — currently just a state-machine flag — finally gets real
money movement behind it.
