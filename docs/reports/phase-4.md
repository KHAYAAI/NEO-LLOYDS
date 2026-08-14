# Phase 4 — Implementation Report

> SIMULATION / TEST ENVIRONMENT — NOT INSURANCE.

**Scope:** Marketplace — listings, capital-provider appetite, matching, expressions of interest. Also: submissions and underwriting move from in-memory to durable storage.
**Status:** Delivered and verified against PostgreSQL, including across a server restart.

## What was built

**`packages/database/prisma/schema.prisma`** — five new tables:
`RiskSubmission`, `UnderwritingAssessment`, `UnderwritingApproval`,
`MarketListing`, `CapitalAppetiteProfile`, `CapitalInterest`. Two migrations
(`0003_submissions_underwriting_marketplace`, `0004_listing_duration`), both
applied and verified.

**`packages/domain/src/marketplace.ts`** — `matchesAppetite()`, a pure,
deterministic compatibility check between a `Listing` and a
`CapitalAppetite`. Every rejection carries an explicit, human-readable reason
— there is no "no" without a stated cause. `rankListings()` orders a set of
listings for a provider: matches first, then by capacity.

**Submissions and underwriting are now durable.** `SubmissionService` and
`UnderwritingService` were rewired from in-memory `Map`s to the new
`SubmissionRepository` / `UnderwritingRepository` ports, with Prisma adapters
in production and in-memory adapters in tests — same pattern as every other
phase. This was the explicit trigger for this phase, per the plan: listing is
the first thing that actually needs to read a submission and an assessment
back after a restart.

**`apps/api/src/marketplace`** — `MarketplaceService` / `MarketplaceController`:

- `POST /marketplace/listings` — lists a `READY_FOR_UNDERWRITING` submission.
  Re-checks underwriting clearance **at listing time, not cached** — a
  revoked or never-granted approval blocks the listing regardless of what
  the submission's own status says.
- `GET /marketplace/listings`, `GET /marketplace/listings/:id` — browse/read;
  open listings are visible to any authenticated caller (this is a
  marketplace), non-open listings are tenant-isolated.
- `POST /marketplace/listings/:id/withdraw` — owner only.
- `POST/GET /marketplace/appetite` — a capital provider's standing
  preferences (risk classes, max exposure, jurisdictions, minimum return,
  max duration, tolerance, concentration limit). One profile per
  organisation; setting again replaces it.
- `GET /marketplace/appetite/matches` — open listings ranked against the
  caller's declared appetite via the domain matcher.
- `POST/DELETE /marketplace/listings/:id/interest`,
  `GET /marketplace/listings/:id/interest` — non-binding expressions of
  interest. Expressing interest outside declared appetite is **allowed, not
  blocked** — the mismatch is recorded in the audit log rather than silently
  permitted or silently refused.

## What this phase deliberately does not do

Turning interest into a binding capital allocation is Phase 5 (Syndication).
Building that here would blur the boundary the architecture insists on
between risk origination, the marketplace, and capital — see
`docs/neo-lloyds-architecture.md` §1. A listing today is an offer with
expressions of interest attached to it; nothing about it commits any
provider's capital.

## Verification

| Check | Result |
|---|---|
| `npm test` | 117 passed (103 at end of Phase 3 → +14: 9 domain matching, 5 API e2e) |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| Two new migrations | both applied cleanly against the running PostgreSQL instance |
| Live API on PostgreSQL, **including a server restart** | full workflow exercised end to end, twice — once before restart, once after |

The restart test is the point of this phase, so it's recorded in detail:
created a risk, a submission, assessed it (LOW band), advanced it through the
full state machine, listed it, created a capital-provider organisation, set
its appetite, confirmed the listing appeared in `/appetite/matches`,
expressed interest — **then killed the server process and started a fresh
one**. After restart: the listing was still `OPEN` with the correct title,
the expression of interest was still present with its original amount and
timestamp, the submission was still `READY_FOR_UNDERWRITING`, and
`/underwriting/risks/:id/clearance` still returned `200`. None of that would
have been true with the Phase 2/3 in-memory maps.

Also verified live: listing a submission still in `DRAFT` (or any non-ready
status) is rejected; listing a `READY_FOR_UNDERWRITING` submission whose risk
was never assessed returns `422 NOT_ASSESSED`; listing the same submission
twice returns `422 ALREADY_LISTED`; a broker without the `CAPITAL_PROVIDER`
role is refused at `403` when attempting to set an appetite profile; browsing
never returns a withdrawn listing.

## External dependencies this phase introduces

None. No new paid or licensed service is required to run Phase 4 — it adds
tables and endpoints against the PostgreSQL instance already in place. The
same two flags from Phase 2/3 stand and sharpen here:

- **Matching logic is illustrative, not a real underwriting-appetite
  methodology.** `matchesAppetite()`'s concentration-limit check
  (listing capacity as a share of the provider's own declared max exposure)
  is a defensible starting rule, not a regulatory concentration standard. A
  real capital marketplace needs this reviewed against actual portfolio risk
  management practice before any real capital commitment relies on it.
- **Expressing interest is genuinely non-binding — and that boundary is now
  load-bearing.** The marketplace layer must never let "expressed interest"
  be mistaken for "committed capital." Phase 5 is where a real commitment
  gets created, with its own invariants (allocations summing to exactly
  100%, no double-allocation). Nothing in this phase's code path can bind
  capital, which is a deliberate scope boundary, not an oversight.

## Known gaps carried forward

Unchanged: no OIDC, no real KYB/KYC, no sanctions screening, no rate
limiting, no HSM, no penetration test.

## Next

Phase 5 — Syndication: divide a listing's capacity across multiple capital
providers' interests, with the invariant that allocations always sum to
exactly 100%, immutable allocation history, and rejection of
over-allocation, duplicate capacity, and exposure-limit violations. This is
also where `CapitalInterest` gains a real consumer beyond display.
