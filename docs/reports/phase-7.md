# Phase 7 — Implementation Report

> SIMULATION / TEST ENVIRONMENT — NOT INSURANCE.

**Scope:** Claims — incident → evidence → verification → coverage check → loss calculation → human review where required → approval → settlement → audit, with automated processing below a configurable threshold.
**Status:** Delivered and verified against PostgreSQL, including a two-claim running-total scenario run live.

## Where a bound allocation stops being a capital position

Every phase through 6 dealt with capital as a *position*: committed,
allocated, reserved, concentrated. Nothing tested it against anything real.
Phase 7 is the first place that changes, at exactly one function:
`requireCoverage` (`packages/domain/src/claims.ts`), called from
`ClaimsService.calculateLoss`. Two things are checked there, together:

1. **The syndication must be BOUND.** An `OPEN` or `CANCELLED` syndication
   was never a real commitment, so `SYNDICATION_NOT_BOUND` is thrown before
   a loss amount is even considered — checked twice, in fact: once eagerly
   when a claim reaches `COVERAGE_CONFIRMED` (so a claim can't even get that
   far against unbound capacity), and again at `calculateLoss` itself.
2. **The claimed loss, plus every prior APPROVED or SETTLED claim already
   recorded against the same syndication, must not exceed what was bound.**
   This is the running total — not a single claim in isolation, the whole
   history of claims against that syndication. A $100,000 syndication that
   has already paid $60,000 can accept at most $40,000 more, forever, no
   matter how many separate claims try to draw against it.

Once a loss clears that test, `computeClaimPayouts` divides it across the
syndication's bound allocations using the same exact-sum `allocateMoney`
split that binding itself uses (ADR-0005) — so what a capital provider
committed to bear is, to the cent, what it now actually owes.

## What was built

**`packages/domain/src/claims.ts`**:
- `requireCoverage` — the coverage test described above.
- `classifyReview` — `AUTO` at or below a configurable threshold,
  `HUMAN_REVIEW` above it.
- `requireClaimApprovalIfNeeded` — mirrors the underwriting gate from
  Phase 3: a `HUMAN_REVIEW` claim cannot reach `APPROVED` without a recorded,
  matching decision.
- `computeClaimPayouts` — the exact per-provider division described above.
- The claim state machine: `REPORTED → EVIDENCE_COLLECTED → VERIFIED →
  COVERAGE_CONFIRMED → LOSS_CALCULATED → {AWAITING_APPROVAL | APPROVED} →
  {APPROVED | REJECTED} → SETTLED`. `LOSS_CALCULATED` is the one state with
  two legal next states, and which one is legal is decided by
  `classifyReview`, not chosen freely by the caller.

**`packages/database`** — one migration: `Claim`, `ClaimPayout`.

**`apps/api/src/claims`** — `POST /claims` (report), `POST /claims/:id/evidence`,
`POST /claims/:id/advance` (the no-extra-data steps),
`POST /claims/:id/loss` (the coverage test), `POST /claims/:id/decide`
(human approval, `CLAIMS_ADMINISTRATOR`-only), `POST /claims/:id/settle`,
`GET /claims/:id`, `GET /claims/:id/payouts`,
`GET /claims/by-syndication/:syndicationId`.

## A real bug caught by the test suite, again

`ClaimsService.decide` originally called `requireClaimApprovalIfNeeded`
unconditionally after recording *any* decision, including `REJECTED`. But
that function's entire purpose is to reject anything that isn't an
`APPROVED` decision — so a legitimate rejection was tripping the very check
meant to guard approvals, and every `REJECTED` call failed with
`CLAIM_NOT_APPROVED`. The e2e test "a rejected claim never produces a payout
and cannot be settled" caught this immediately. Fixed by only running that
confirmation when the decision is actually `APPROVED`; a `REJECTED` decision
needs no further gate; the state-machine transition check already permits it
as a legitimate terminal outcome. Documented in code so the distinction
between "this function confirms an approval" and "this function processes
any decision" doesn't collapse again.

## Verification

| Check | Result |
|---|---|
| `npm test` | 182 passed (156 at end of Phase 6 → +26: 21 domain claims, 5 net new API e2e after fixing two test-data bugs of my own) |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| One new migration | applied |
| Live API on PostgreSQL | the exact running-total scenario, run end to end |

The live run: a $100,000-capacity syndication, fully bound to one provider.
A first claim for $60,000 correctly classified `HUMAN_REVIEW` (above the
$25,000 default threshold), approved, and paid out — the payout endpoint
returned exactly `$60,000` to the one provider holding the syndication, to
the cent. A second claim on the *same* syndication for $45,000 was then
correctly rejected with `422 LOSS_EXCEEDS_REMAINING_CAPACITY`, reporting
`remaining: $40,000` in the error detail ($100,000 capacity − $60,000 already
approved). The same second claim at exactly $40,000 was accepted. Also
verified live: attempting to confirm coverage against a syndication that was
never bound returns `403`/`422 SYNDICATION_NOT_BOUND` before any loss amount
is even considered.

## What "settlement" means in this phase, precisely

`POST /claims/:id/settle` marks a claim `SETTLED`. **No money moves.** This
is stated plainly because it would be easy to read "settlement" as more than
it is: real settlement — a bank transfer, a stablecoin payment, any actual
movement of value — is Phase 10's `SettlementProvider` abstraction, which
does not exist yet. What Phase 7 delivers is the *decision* that a claim is
payable and exactly how much each provider owes, computed and recorded
exactly; what happens after that decision, in the real world, is out of
scope until Phase 10 gives it somewhere to go.

## External dependencies this phase introduces

None. No new paid or licensed service.

- **The auto-approval threshold is illustrative, same caveat as every
  threshold before it** (Phase 3's underwriting bands, Phase 4's appetite
  ceilings): `DEFAULT_AUTO_APPROVAL_CEILING` at $25,000 is a defensible
  starting number, not one derived from real claims experience, and it is
  USD-only exactly like Phase 3's default. This gap has been flagged every
  phase it has recurred in; Phase 7 is the phase where it stops being
  theoretical, because a threshold set wrong here decides whether real
  money would move without a human ever looking at the claim.
- **Evidence is a bare string reference (`evidenceRef`) with no storage
  behind it.** Real evidence — photos, documents, sensor logs — needs
  object storage (S3-compatible, already named as a stack dependency in
  the architecture doc) and is not wired up in this phase. A claim today
  records that evidence *was* referenced, not the evidence itself.
- **Claims adjudication in this system is still entirely internal.** Nothing
  here integrates an actual third-party loss adjuster, surveyor, or
  independent verification service — `VERIFIED` is a status a
  `CLAIMS_ADMINISTRATOR` sets by calling an endpoint, not a finding backed by
  an external party. That is appropriate for a prototype and explicitly not
  appropriate for anything real.

## Known gaps carried forward

Unchanged: no OIDC, no real KYB/KYC, no sanctions screening, no rate
limiting, no HSM, no penetration test.

## Next

Phase 8 — Simulation & Digital Twin: port closure, supply-chain disruption,
commodity shock, weather, infrastructure failure, counterparty failure,
geopolitical, cyber. This is the brief's stated core differentiator, and the
first phase that runs *forward* from the risk graph rather than processing
something that already happened — "what would this event do to what's
insured here" rather than "here is what happened, adjudicate it."
