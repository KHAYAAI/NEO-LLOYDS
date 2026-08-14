# Phase 2 — Implementation Report

> SIMULATION / TEST ENVIRONMENT — NOT INSURANCE.

**Scope:** Risk Submission + Deterministic Scoring + AI Risk Analyst.
**Status:** Delivered and verified against PostgreSQL.

## What was built

**`packages/domain/src/scoring.ts`** — a deterministic scoring engine. Given a
set of declared `RiskFactor`s, a maximum estimated loss, duration, mitigation
coverage, correlation count and concentration share, it computes probability,
severity, expected loss (low/expected/high), correlation score, concentration
score and mitigation score — every one of them an `Estimate` or `RangeEstimate`
carrying explicit confidence and basis, never a bare number. Zero factors
produces `INSUFFICIENT_DATA`, not a guess. Same input always produces bit-for-bit
identical output — verified directly in tests.

**`packages/domain/src/analyst.ts`** — the contract the AI Risk Analyst must
satisfy. `analystFinding()` is the *only* way to construct a finding, and it
refuses to run if `referencedData` is empty or `modelId`/`modelVersion` are
missing. The `AnalystProvider` interface has exactly one method, `analyse`,
and no method that approves, prices, or binds — advisory-only is structural,
not a convention someone could forget.

**`packages/domain/src/submission.ts`** — the risk submission state machine:
`DRAFT → SUBMITTED → ANALYSING → SCORED → READY_FOR_UNDERWRITING`, forward-only,
enforced by `requireTransition`.

**`apps/api/src/scoring`** — `POST /scoring/risks/:id`, wrapping the pure
scoring function with tenant authorisation and audit.

**`apps/api/src/analyst`** — `GET /analyst/risks/:id`, with two providers:
- `NullAnalystProvider` — the default. Returns one grounded
  `MISSING_INFORMATION` finding when no LLM key is configured, rather than
  fabricating an assessment.
- `AnthropicAnalystProvider` — calls the Anthropic Messages API directly (no
  SDK dependency), requests strict JSON findings, and parses them through
  `analystFinding()` before they can leave the service. A provider failure
  (bad key, timeout, malformed JSON) degrades to the same grounded
  `MISSING_INFORMATION` finding rather than raising to the caller or guessing.

**`apps/api/src/submission`** — the workflow endpoints. Submissions are held
in-memory in this phase (not a Prisma table) — the workflow logic is what's
new; persistence gains a real reason to exist once Phase 4 marketplace listing
consumes a `READY_FOR_UNDERWRITING` submission.

## Verification

| Check | Result |
|---|---|
| `npm test` | 84 passed (65 passed at end of Phase 1 → +19: 12 domain scoring/analyst/submission, 7 API e2e) |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| Live API on PostgreSQL | scoring, analyst, and submission-workflow endpoints exercised by hand against the seeded MVP risk |

Verified by hand against the running service: scoring the same request twice
returns identical `expectedLoss`; scoring with an empty factor list returns
`INSUFFICIENT_DATA`; the analyst (no API key set) returns a `MISSING_INFORMATION`
finding citing `null-provider`/`1.0.0` and the risk id; a submission created via
API starts `DRAFT`, advances to `SUBMITTED`, and a skip straight to
`READY_FOR_UNDERWRITING` is rejected with `422 INVALID_SUBMISSION_TRANSITION`.

## External dependencies this phase introduces

Phase 1 needed none beyond PostgreSQL. Phase 2 adds one **optional** external
dependency and flags two the *next* phases will need:

- **`ANTHROPIC_API_KEY` (optional, not required to run this phase).** Without
  it, `/analyst/risks/:id` runs the null provider and is fully functional —
  every test above passes with no key set. With it, `AnthropicAnalystProvider`
  makes live calls. This is deliberate: Phase 2 must be demonstrable and
  testable with zero paid dependencies, and the provider abstraction is what
  makes swapping in a real model (or a second provider, e.g. OpenAI, later) an
  adapter change, not a rewrite.
- **Not yet needed, flagged for Phase 5+ (capital ledger / syndication):** any
  real financial commitment. Nothing in Phase 2's scoring output is wired to
  anything that moves money — `expectedLoss` is descriptive, not an
  instruction.
- **Not yet needed, flagged for regulated production:** the scoring formula in
  `SCORING_MODEL_VERSION = 'deterministic-v1'` is an unvalidated, illustrative
  weighting — it has not been calibrated against real loss history. Before any
  figure it produces informs a real capital or premium decision, it needs
  either licensed actuarial data or a contracted actuary to validate or replace
  it. This is a data/expertise dependency, not a code dependency, and no
  amount of further engineering substitutes for it.

## Two decisions worth flagging

**The analyst degrades instead of failing.** A provider exception (bad key,
timeout, malformed model output) is caught in `AnalystService.analyseRisk` and
converted into a single `MISSING_INFORMATION` finding with `degraded: true`
rather than propagated as a 500. This mirrors the no-key case deliberately:
"the analyst has nothing to say right now" is always a valid, safe response;
an analyst that sometimes throws and sometimes fabricates is not.

**Submissions are in-memory, not persisted.** This is a scope decision, not an
oversight — noted explicitly so it isn't mistaken for durability that doesn't
exist yet. A submission created via the API today does not survive a server
restart. It gets a Prisma table in the phase that actually reads it back
(marketplace listing, Phase 4), consistent with the project's rule against
building storage ahead of a consumer.

## Known gaps carried forward from Phase 1

Unchanged: no OIDC, no real KYB/KYC provider, no sanctions screening, no rate
limiting, no HSM, no penetration test. See `docs/security-model.md` §8 and
`docs/reports/phase-1.md`.

## Next

Phase 3 — Underwriting: turn a `RiskScore` into an `UnderwritingAssessment`
(eligibility, suggested premium range, capital requirement, exclusions,
conditions, required evidence) and wire the `LOW/MEDIUM/HIGH/EXTREME`
approval bands already defined in `packages/domain/src/identity.ts` to an
actual human-review queue — the point where "advisory" has to start meaning
something operationally, not just structurally.
