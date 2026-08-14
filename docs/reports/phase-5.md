# Phase 5 — Implementation Report

> SIMULATION / TEST ENVIRONMENT — NOT INSURANCE.

**Scope:** Syndication — dividing a listing's capacity across multiple capital providers, with allocations that sum to exactly 100%, immutable allocation history, and rejection of over-allocation, duplicate capacity, and exposure-limit violations.
**Status:** Delivered and verified against PostgreSQL, including direct SQL attempts to defeat the invariants.

## Where the line is drawn, precisely

This is the first phase where the system stops being purely advisory and
starts producing a binding commitment. The brief asked for precision about
where that line sits in code, so here it is, exactly:

- **Everything before `bindAllocations` (packages/domain/src/syndication.ts)
  is a proposal.** `proposeAllocation` and `removeAllocation` operate on a
  plain list and enforce only that the *proposed* total never exceeds 100%.
  Nothing they do writes a commitment anywhere — a proposal can be withdrawn
  and re-proposed without limit while a syndication is OPEN.
- **`bindAllocations` is the one function that crosses it.** It refuses to
  run at all unless the proposals already sum to exactly 100%
  (`requireFullyAllocated`), and it recomputes the final amounts with
  `allocateMoney` — the one money-split function in the codebase proven to
  distribute a total with no minor unit lost or invented — rather than
  trusting the indicative `scaleMoney` figures accumulated during proposal.
  It is pure: no side effects, no storage, so the binding computation itself
  is independently reproducible and auditable.
- **`SyndicationService.bind` (apps/api) is where the crossing becomes
  real.** It calls `bindAllocations`, then persists the result and flips the
  syndication to `BOUND` in one atomic transaction, then marks the
  underlying listing `MATCHED`. Only the listing owner may call it — a
  capital provider cannot bind its own or anyone else's allocation, which
  would let one participant force a commitment on the rest of the syndicate.
- **After that transaction commits, nothing can undo it.** Not a bug in the
  service, not a direct SQL statement, not another process with database
  credentials. Two Postgres triggers, added in this phase's second
  migration, enforce this independently of the application: one makes
  `SyndicationAllocationEvent` append-only forever (identical pattern to
  `AuditRecord`'s trigger from Phase 1); the other refuses `UPDATE` or
  `DELETE` on any `SyndicationAllocation` row whose parent syndication is
  `BOUND`, checked by a live subquery against the syndication's current
  status, not a cached flag.

## What was built

**`packages/domain/src/syndication.ts`** — `proposeAllocation`,
`removeAllocation`, `requireFullyAllocated`, `bindAllocations`, each raising
a specific `DomainError` code: `INVALID_SHARE`, `DUPLICATE_ALLOCATION`,
`OVER_ALLOCATION`, `EXPOSURE_LIMIT_EXCEEDED`, `ALLOCATION_NOT_FOUND`,
`INCOMPLETE_ALLOCATION`.

**`packages/database`** — two migrations: the `Syndication`,
`SyndicationAllocation`, `SyndicationAllocationEvent` tables, and the two
triggers described above.

**`apps/api/src/syndication`** — `open` (one syndication per listing),
`propose` (requires a live, non-withdrawn `CapitalInterest` on the listing —
this is where Phase 4's expressions of interest finally get consumed for
something real rather than merely displayed), `withdraw`, `bind`,
`get`/`listAllocations`/`listEvents`.

## Verification

| Check | Result |
|---|---|
| `npm test` | 139 passed (117 at end of Phase 4 → +22: 14 domain syndication invariants, 8 API e2e) |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| Two new migrations | applied; triggers verified directly with raw SQL before any application code was written against them |
| Live API on PostgreSQL | full open → propose (×3, deliberately awkward 3334/3333/3333 bps) → bind workflow, then direct SQL and API attempts to defeat every invariant post-bind |

The trigger verification came first, deliberately, before any service code:
inserted a syndication and allocation directly via SQL, updated the
allocation while `OPEN` (succeeded), flipped the syndication to `BOUND`, then
attempted an `UPDATE`, a `DELETE`, and a cascading `DELETE` from the parent
listing — all three were rejected by Postgres with the expected error, before
a single line of `SyndicationService` existed. Only after confirming the
database would hold the line regardless of application correctness was the
service layer built on top of it.

The live end-to-end run afterward used the same three-way 3334/3333/3333
basis-point split the domain tests specifically chose to stress rounding
behaviour, confirmed the bound amounts summed to the listing's capacity
exactly (100,000 minor units, no remainder), then — against that real,
API-created, bound syndication, not a synthetic row — ran the same direct-SQL
`UPDATE` attempt and confirmed Postgres rejected it, followed by an API
re-bind attempt (`422 SYNDICATION_NOT_OPEN`) and a check that the underlying
listing had correctly moved to `MATCHED`.

Also verified live and in the e2e suite: a provider with no live interest on
the listing cannot propose (`422 NO_LIVE_INTEREST`); the same provider
proposing twice is refused (`DUPLICATE_ALLOCATION`); a proposal that would
push the total past 100% is refused (`OVER_ALLOCATION`); a proposal above a
provider's declared appetite ceiling is refused (`EXPOSURE_LIMIT_EXCEEDED`);
binding an incomplete syndication is refused (`INCOMPLETE_ALLOCATION`); a
capital provider attempting to bind is refused (`403`, role-gated); and
withdrawing a proposal frees its share for reproposal while leaving a
permanent `REMOVED` record in history.

## A bug caught before it shipped

Early in writing `SyndicationService.propose`, the tenant-access check used
`'WRITE'`, which requires `ctx.organisationId === syndication.organisationId`
— but the syndication's owning organisation is the *listing owner* (the risk
originator), not the capital provider proposing an allocation. That check
would have made it impossible for any capital provider to ever propose
anything against a syndication they don't own, which is backwards: a
provider proposing its own allocation needs the syndication to be `OPEN`, not
tenant-owned by them. Caught before running the test suite, by re-reading the
authorisation logic against what the endpoint is actually supposed to permit;
documented in code with an explicit comment so the distinction (ownership vs.
"is the syndication in a mutable state") doesn't get collapsed again later.

## External dependencies this phase introduces

None. No new paid or licensed service. The same standing flags apply and
sharpen further now that a real commitment exists:

- **The exposure-limit check uses the same illustrative appetite model from
  Phase 4.** It is now checked at the moment that matters most — immediately
  before a provider's capital is bound — but the concentration/exposure
  arithmetic itself remains a defensible default, not a validated risk
  methodology. This is the last phase where that gap is purely theoretical;
  from here, "review the appetite and exposure model against real portfolio
  risk practice" moves from a Phase 4 footnote to an actual production
  blocker, because Phase 6 (Capital Ledger) is what will report these bound
  allocations as real exposure.
- **A bound syndication in this system is a simulated commitment, not a
  legally enforceable one.** The database will not let anyone alter the
  numbers once bound, and that is a genuinely strong technical guarantee —
  but a technical guarantee of data integrity is not the same thing as legal
  enforceability. Nothing in this codebase creates a contract. That
  distinction has to survive all the way to launch messaging, not just this
  report.

## Known gaps carried forward

Unchanged: no OIDC, no real KYB/KYC, no sanctions screening, no rate
limiting, no HSM, no penetration test.

## Next

Phase 6 — Capital Ledger: committed / available / allocated / reserved /
exposed / released capital, concentration dashboards by geography, industry,
risk class, counterparty, event, and asset. This is where a `BOUND`
syndication's allocations become a capital provider's tracked exposure rather
than a syndication-scoped fact — the first phase where a single provider's
total exposure across *every* syndication they've bound into has to be
computed and enforced against, not just one listing's.
