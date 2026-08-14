# Phase 6 — Implementation Report

> SIMULATION / TEST ENVIRONMENT — NOT INSURANCE.

**Scope:** Capital Ledger — committed / allocated / reserved / available capital, computed live across every syndication a provider participates in; concentration by risk class, jurisdiction, and counterparty.
**Status:** Delivered and verified against PostgreSQL, including a live scenario specifically constructed so only the cross-syndication check catches it.

## The gap this phase closes, precisely

Phase 5's `EXPOSURE_LIMIT_EXCEEDED` check (`proposeAllocation` in
`packages/domain/src/syndication.ts`) compares one proposed allocation
against a provider's `CapitalAppetite.maxExposure` — a single number, checked
against a single listing. It has no way to see what else that provider has
proposed or bound on any *other* listing, because nothing before this phase
ever looked.

That gap is exploitable in an entirely mundane way, not an edge case: a
provider with a generous per-listing appetite ceiling can pass that check on
ten different listings simultaneously and still end up committed to far more
capital than it has ever actually declared. Phase 6 closes it with one new
function, `requireCapacityForProposal` (`packages/domain/src/capital-ledger.ts`),
called from `SyndicationService.propose` immediately after the existing
per-listing check, built from `listAllocationsForOrganisation` — a query
that, for the first time, looks at every syndication a provider is in, not
one.

## What was built

**`packages/domain/src/capital-ledger.ts`**:
- `computePosition(commitment, contributions)` — sums BOUND contributions as
  `allocated`, OPEN as `reserved`, ignores CANCELLED, and reports `available`
  and `utilisationBps`. Deliberately never throws for an already-overcommitted
  position — `available` floors at zero but `utilisationBps` is allowed to
  exceed 10,000, so an overcommitment is *visible* in the report rather than
  hidden by clamping.
- `requireCapacityForProposal(position, proposedAmount)` — the enforcement
  point described above.
- `concentrationBy(contributions, keyOf, currency)` — groups a provider's
  live exposure by an arbitrary key and reports each bucket's share.

**`packages/database`** — one migration: `CapitalCommitment`, one row per
organisation. Deliberately the *only* new table. Exposure itself is computed
live from `SyndicationAllocation` on every read, not cached in a running
total that could drift from the data it's supposed to summarise — the same
principle Phase 4's marketplace matching and Phase 5's binding computation
both already follow.

**`apps/api/src/capital`** — `POST/GET /capital/commitments`,
`GET /capital/exposure`, `GET /capital/concentration?by=riskClass|jurisdiction|counterparty`.

**`SyndicationService.propose`** — now requires a `CapitalCommitment` to
exist at all (`422 NO_CAPITAL_COMMITMENT` otherwise — a provider cannot
participate in syndication without first declaring a ceiling), then builds
that provider's full cross-syndication position and enforces it before
allowing the proposal to be recorded.

## Verification

| Check | Result |
|---|---|
| `npm test` | 156 passed (139 at end of Phase 5 → +17: 13 domain capital-ledger, 4 API e2e — three of which are the live-workflow tests below) |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| One new migration | applied |
| Live API on PostgreSQL | the exact scenario described in this phase's brief, run end to end |

The load-bearing test — both in the automated suite and repeated by hand
against the live server — was built specifically to be invisible to every
check that existed before this phase:

- A provider commits **$700** total.
- It sets a per-listing appetite ceiling of **$1,000** (generous — nowhere
  near tripped by anything below).
- Two entirely separate listings are opened, **$600** capacity each, by two
  different risk originators.
- The provider proposes **$300** on listing A. Passes every check: well
  under the $1,000 per-listing ceiling, well under $700 committed.
- The provider then proposes **$500** on listing B. In isolation, this is
  also fine — $500 is under the $1,000 per-listing ceiling, and listing B's
  own exposure check has no way to know about listing A. **Only the
  cross-syndication check catches it**: $300 (listing A) + $500 (listing B)
  = $800, which exceeds the $700 the provider actually committed.
  `422 INSUFFICIENT_COMMITTED_CAPITAL`, with `available: $400` reported
  in the error detail (`$700 committed − $300 already reserved`).
- Run live against PostgreSQL, byte for byte the same numbers: committing
  $700, proposing $300 on one listing (succeeds), then $500.04 on a second
  (rejected — `available: $400`), then exactly the remaining $399.96 (accepted,
  landing at $4 of $700 remaining, `utilisationBps: 9999`). The one rejection
  in between was itself informative: a share of 6667bps of $600 rounds to
  $400.02 via `scaleMoney`, two cents over remaining capacity — the exactness
  invariant from Phase 1 (ADR-0005) catching a two-cent overshoot in a live
  request, not just in a unit test.
- `GET /capital/exposure` after binding one syndication and leaving another
  proposed-but-unbound correctly reported `allocated` (from the BOUND one)
  and `reserved` (from the OPEN one) as separate figures, both drawn from the
  same live query, both summed into `available` correctly.

## What concentration reporting does not yet cover

`concentrationBy` groups by risk class, jurisdiction, or counterparty today
— every one of those is already a structured field on `MarketListing`. The
brief additionally asks for concentration by **industry, event, and asset**.
Those are not computable yet, and this is stated as a real gap rather than
worked around: `MarketListing` does not carry an industry classification,
and neither event nor asset concentration has a natural join target in the
current schema — a listing references one `riskId` on the graph, not a set
of assets or a catalogued event type. Closing this requires either the risk
graph carrying richer structured attributes on submission (a Phase 2/8
concern, since the Event Simulation Engine in Phase 8 will need much the
same data) or a deliberate schema extension once there is a concrete
consumer for it. Building it now, ungrounded in real data, would mean
either fabricating a classification or leaving the field permanently
`UNKNOWN` — worse than not having it.

## External dependencies this phase introduces

None. No new paid or licensed service.

- **A committed-capital ceiling in this system is still self-declared, not
  verified against anything.** Nothing checks that a provider claiming a
  $10,000,000 commitment actually holds that capital anywhere. That
  verification — proof of funds, a banking relationship, or a regulator-grade
  KYB check on financial standing — is exactly the kind of dependency flagged
  since Phase 1: a real bank/custodian relationship and a real KYB provider,
  neither of which this codebase can substitute for.
- **The exposure and concentration figures computed here are the first ones
  in the system with real operational teeth** (they gate whether a provider
  can propose further allocations), which raises the bar on the standing
  Phase 2/4/5 flag about calibration: `CapitalAppetite`'s exposure and
  concentration limits, and now the capital ledger built on top of them, need
  review against real portfolio risk practice before any of this informs a
  decision with real money behind it.

## Known gaps carried forward

Unchanged: no OIDC, no real KYB/KYC, no sanctions screening, no rate
limiting, no HSM, no penetration test.

## Next

Phase 7 — Claims: incident → evidence → verification → policy match →
coverage check → loss calculation → human review where required → approval
→ settlement → audit, with automated processing for low-complexity cases and
a configurable high-value threshold for human review. This is the phase
where a bound syndication's allocation stops being purely a capital position
and starts being tested against an actual loss.
