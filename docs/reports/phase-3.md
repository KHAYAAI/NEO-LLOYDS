# Phase 3 — Implementation Report

> SIMULATION / TEST ENVIRONMENT — NOT INSURANCE.

**Scope:** Underwriting.
**Status:** Delivered and verified against PostgreSQL.

## What was built

**`packages/domain/src/underwriting.ts`** — `assessUnderwriting()` turns a
`RiskScore` into an `UnderwritingAssessment`: eligibility, approval band,
suggested premium range, capital requirement, suggested capacity, exclusions,
conditions, required evidence. `classifyBand()` maps expected-loss-to-MEL
ratio, an absolute expected-loss ceiling, and probability confidence onto the
four bands already defined in `packages/domain/src/identity.ts`
(`LOW/MEDIUM/HIGH/EXTREME`). `requireApprovalIfNeeded()` is the enforcement
point: it throws unless a matching, approved, non-stale
`UnderwritingApproval` exists for any band above LOW.

**`apps/api/src/underwriting`** — four endpoints: `POST .../assess`,
`GET .../assessment`, `POST .../approve` (role-gated to `UNDERWRITER`, not
just scope-gated), and `GET .../clearance`, which is the single choke point
every future phase (marketplace listing, syndication, binding) must call
before treating a risk as underwritten.

## The one real bug this phase caught

Building the tests surfaced a genuine defect before it shipped: `classifyBand`
originally gated automation eligibility on the *blended* `score.confidence`,
which is the minimum across probability, correlation, concentration and
mitigation confidences. But `correlationScore` and `concentrationScore` carry
a deliberately conservative confidence ceiling (0.6 and lower when there's no
correlation data at all) by design — that's appropriate for *those* scores,
but it meant no risk could ever reach LOW band, even a tiny, well-understood
one, because the blended minimum was always dragged down by an unrelated
sub-score. Fixed by gating automation eligibility on
`score.probability.confidence` specifically — the confidence of the estimate
that actually determines size — not the blended figure. Covered by
`packages/domain/test/underwriting.test.ts`'s "never blocks a LOW-band
assessment even with no approval" case, which failed before the fix and passes
after it.

This is exactly the kind of error the domain-first, test-first structure is
meant to catch before it reaches an API response, let alone a real decision.

## Verification

| Check | Result |
|---|---|
| `npm test` | 103 passed (84 at end of Phase 2 → +19: 13 domain, 6 API e2e) |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| Live API on PostgreSQL | full assess → block → approve → clear loop exercised by hand |

Verified by hand against the running service: a $100k expected-loss risk
against a $10m MEL correctly lands in MEDIUM (its absolute expected loss
exceeds the $50k LOW ceiling) and `clearance` returns `422 APPROVAL_REQUIRED`;
after `POST .../approve` with `APPROVED`, the same `clearance` call returns
`200`. A separately created, genuinely small risk ($1,000 MEL, 1% likelihood,
95% confidence) correctly lands in LOW and clears with *zero* approval calls
made. The audit log shows both assessments and the approval decision in
correct order, each with `policy` set to the model version or control band.

## External dependencies this phase introduces

None required to run it. One flagged for before production use, restated from
Phase 2 because underwriting is where it starts to matter operationally:

- **The scoring and underwriting formulas are illustrative, not calibrated.**
  `DEFAULT_APPROVAL_THRESHOLDS` (5%/20%/50% ratio bands, $50k LOW ceiling,
  75% minimum confidence) are defensible starting numbers, not numbers derived
  from loss history. Before any premium range or capital requirement this
  phase produces informs a real decision, these thresholds need review by a
  contracted actuary or calibration against real claims data — a data/expertise
  dependency, not a code dependency (see `docs/reports/phase-2.md`, which
  flagged the same gap for the scoring engine underneath this).
- **The `UNDERWRITER` role check is real RBAC, but the underwriter behind it
  is not yet a real person with real professional accountability wired up.**
  Nothing stops any organisation holding the `UNDERWRITER` market role from
  approving anything today. Before production, this needs to be paired with
  actual underwriting authority limits per individual, not just per
  organisation — a governance policy decision, tracked in
  `docs/governance/model-governance.md`.

## Known gaps carried forward

Unchanged from Phase 1–2: no OIDC, no real KYB/KYC, no sanctions screening,
no rate limiting, no HSM, no penetration test. Assessments and approvals
remain in-memory (not a Prisma table), same rationale as Phase 2 submissions —
they get a durable table once Phase 4 marketplace listing reads them back.

## Next

Phase 4 — Marketplace: list a cleared, underwritten risk, let capital
providers express interest against their declared appetite (risk class, max
exposure, geography, minimum return, duration, tolerance, concentration
limits), and match. This is also the phase that finally gives submissions and
underwriting assessments a reason to move from in-memory maps to real tables.
