# Neo-Lloyds API — Phase 1

> SIMULATION / TEST ENVIRONMENT — NOT INSURANCE.
> Every response carries a `notice` field repeating this. It is applied by a
> global interceptor so no endpoint can omit it.

OpenAPI/Swagger UI: `GET /docs`.

## Authentication

```
Authorization: Bearer <keyId>.<secret>
```

Secrets are stored as a salted SHA-256 hash and compared in constant time. The
plaintext is returned once at issue and is never retrievable. Unknown key and
wrong secret return the same message, deliberately.

Two gates apply to every route, and both must pass: the credential's **scope**
(`graph:read`, `graph:write`, `identity:admin`, `identity:read`, `audit:read`,
or `*`) and the organisation's **market role**. Tenant isolation applies on top:
a caller may only reach its own organisation's objects, except a `REGULATOR`,
which may read across tenants (every such read is audited) but never write.

## Public

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness, phase, ontology version |
| GET | `/ontology` | The machine-readable ontology the server validates against |
| GET | `/ontology/version` | Version and counts |

## Identity

| Method | Path | Scope | Notes |
|---|---|---|---|
| POST | `/identity/organisations` | `identity:admin` | `jurisdiction` is required — there is no default (ADR-0004). `AI_AGENT` requires `principalOrganisationId`; an agent may not be another agent's principal. |
| GET | `/identity/organisations` | `identity:read` | |
| GET | `/identity/organisations/:id` | `identity:read` | Tenant-isolated |
| POST | `/identity/organisations/:id/roles` | `identity:admin` | One market role per call; each is a separate grant |
| POST | `/identity/organisations/:id/kyb` | `identity:admin` | Prototype: manual decision only, no KYB provider is integrated |
| POST | `/identity/organisations/:id/credentials` | `identity:admin` | Returns the secret **once** |
| POST | `/identity/credentials/:keyId/revoke` | `identity:admin` | Takes effect immediately |
| POST | `/identity/mandates` | `identity:admin` | Only the principal may mandate its agent |
| GET | `/identity/audit` | `audit:read` | Append-only log, newest first; regulators see across tenants |

## Risk graph

| Method | Path | Scope / roles | Question |
|---|---|---|---|
| POST | `/graph/nodes` | `graph:write` + originator/broker/underwriter/syndicate | Provenance mandatory |
| POST | `/graph/edges` | same | Rejects illegal endpoint pairs and `DEPENDS_ON` cycles |
| GET | `/graph/entities/:id/what-can-fail` | `graph:read` | Q1 |
| GET | `/graph/assets/:id/dependencies` | `graph:read` | Q2, both directions |
| GET | `/graph/risks/:id/picture` | `graph:read` | Q3–Q6: exposure, losses, cover, capital |
| GET | `/graph/entities/:id/correlations` | `graph:read` | Q7: shared dependencies |
| GET | `/graph/subgraph` | `graph:read` | The caller's whole graph |

Read queries accept `?maxDepth=` (capped at 12) and `?verifiedOnly=true`, which
excludes `AI_INFERRED` edges — use it wherever a decision requires verified data.

## Scoring (Phase 2)

| Method | Path | Scope | Notes |
|---|---|---|---|
| POST | `/scoring/risks/:id` | `scoring:compute` | Deterministic: identical input always yields an identical `RiskScore`. No factors → `INSUFFICIENT_DATA`, not a guess. |

## AI Analyst (Phase 2)

| Method | Path | Scope | Notes |
|---|---|---|---|
| GET | `/analyst/risks/:id` | `graph:read` | Advisory only. Every finding cites `modelId`, `modelVersion` and `referencedData`; construction fails otherwise (ADR-0006). With no `ANTHROPIC_API_KEY` set, returns a single grounded `MISSING_INFORMATION` finding rather than fabricating an assessment — this is also the production fallback if the provider call fails. |

## Risk submission (Phase 2)

| Method | Path | Scope / roles | Notes |
|---|---|---|---|
| POST | `/submissions` | `submission:write` + originator/broker | Starts `DRAFT` |
| POST | `/submissions/:id/advance` | `submission:write` + originator/broker | `DRAFT → SUBMITTED → ANALYSING → SCORED → READY_FOR_UNDERWRITING`. Backward or skipped transitions return `422 INVALID_SUBMISSION_TRANSITION`. |
| GET | `/submissions/:id` | `submission:read` | Tenant-isolated |
| GET | `/submissions` | `submission:read` | Caller's own organisation only |

Submissions are held in-memory in Phase 2 (not yet a Prisma table): the
workflow is what's new, and persisting it gains a real consumer once Phase 4
marketplace listing exists to act on a `READY_FOR_UNDERWRITING` submission.

## Underwriting (Phase 3)

| Method | Path | Scope / roles | Notes |
|---|---|---|---|
| POST | `/underwriting/risks/:id/assess` | `underwriting:assess` + `UNDERWRITER` | Scores and assesses in one call; returns band, premium range, capital requirement, exclusions, conditions, required evidence |
| GET | `/underwriting/risks/:id/assessment` | `underwriting:read` | The most recent assessment recorded |
| POST | `/underwriting/risks/:id/approve` | `underwriting:approve` + `UNDERWRITER` | Records a human decision (`APPROVED`/`REJECTED`); role-gated, not just scope-gated |
| GET | `/underwriting/risks/:id/clearance` | `underwriting:read` | `200` if clear to proceed; `422` with `NOT_ASSESSED`, `APPROVAL_REQUIRED`, `STALE_APPROVAL`, or `NOT_APPROVED` otherwise |

`LOW` band clears automatically with no approval call. `MEDIUM`/`HIGH`/`EXTREME`
are blocked at `clearance` until a matching `APPROVED` decision exists — this
is the single choke point later phases (marketplace, syndication) call before
treating a risk as underwritten. Approvals are held in-memory in Phase 3.

## Marketplace (Phase 4)

Submissions and underwriting assessments/approvals are now durable (Prisma
tables), not in-memory — this is what makes the listing endpoints below
correct across a restart.

| Method | Path | Scope / roles | Notes |
|---|---|---|---|
| POST | `/marketplace/listings` | `marketplace:list` + originator/broker | Requires the submission is `READY_FOR_UNDERWRITING` and its risk currently has underwriting clearance — both re-checked, not cached. `422 SUBMISSION_NOT_READY` / `NOT_ASSESSED` / `APPROVAL_REQUIRED` / `ALREADY_LISTED` as applicable. |
| POST | `/marketplace/listings/:id/withdraw` | `marketplace:list` + originator/broker | Owner only |
| GET | `/marketplace/listings/:id` | `marketplace:read` | Open listings are marketplace-visible to any authenticated caller; non-open listings are tenant-isolated |
| GET | `/marketplace/listings` | `marketplace:read` | Optional `?riskClass=` / `?jurisdiction=` filters; withdrawn/matched/expired never appear |
| POST | `/marketplace/appetite` | `marketplace:appetite` + `CAPITAL_PROVIDER` | Replaces any existing profile for the caller's organisation |
| GET | `/marketplace/appetite` | `marketplace:appetite` | |
| GET | `/marketplace/appetite/matches` | `marketplace:appetite` | Open listings ranked against the caller's appetite; every non-match carries explicit reasons |
| POST | `/marketplace/listings/:id/interest` | `marketplace:interest` + `CAPITAL_PROVIDER` | Non-binding. Expressing interest outside declared appetite is allowed and recorded, not blocked |
| DELETE | `/marketplace/listings/:id/interest` | `marketplace:interest` + `CAPITAL_PROVIDER` | Withdraws the caller's own interest |
| GET | `/marketplace/listings/:id/interest` | `marketplace:read` | Listing owner only |

## Syndication (Phase 5)

> This is where the system crosses from non-binding to binding. Every
> endpoint below is annotated with which side of that line it's on.

| Method | Path | Scope / roles | Binding? | Notes |
|---|---|---|---|---|
| POST | `/syndication` | `syndication:manage` + originator/broker | No | Opens a syndication against an `OPEN` listing. One per listing (`422 ALREADY_SYNDICATED` otherwise). |
| GET | `/syndication/:id` | `syndication:read` | — | |
| POST | `/syndication/:id/allocations` | `syndication:allocate` + `CAPITAL_PROVIDER` | **No — proposal only** | Requires a live (non-withdrawn) `CapitalInterest` on the underlying listing (`422 NO_LIVE_INTEREST` otherwise). Enforces no duplicate capacity (`DUPLICATE_ALLOCATION`), no over-allocation (`OVER_ALLOCATION`), no exposure-limit breach (`EXPOSURE_LIMIT_EXCEEDED`) — all against the *proposed* total only. |
| DELETE | `/syndication/:id/allocations` | `syndication:allocate` + `CAPITAL_PROVIDER` | No | Withdraws the caller's own proposal. Freely available while `OPEN`. |
| GET | `/syndication/:id/allocations` | `syndication:read` | — | Current state |
| GET | `/syndication/:id/events` | `syndication:read` | — | The complete, immutable history: every `PROPOSED`/`REMOVED`/`BOUND` event, forever, enforced append-only by a database trigger |
| POST | `/syndication/:id/bind` | `syndication:manage` + originator/broker | **YES — THE BINDING CALL** | Requires proposals summing to exactly 100% (`422 INCOMPLETE_ALLOCATION` otherwise). Only the listing owner may call this — never a capital provider (`403`). After it returns: the syndication is `BOUND`, the listing is `MATCHED`, and a database trigger refuses any further mutation of this syndication's allocations, independent of application code. |

## Errors

Domain invariant violations return `422` with a machine-readable code:

```json
{
  "error": {
    "code": "DEPENDENCY_CYCLE",
    "message": "Edge … -DEPENDS_ON-> … would create a cycle",
    "details": { "fromId": "…", "toId": "…", "edgeType": "DEPENDS_ON" }
  },
  "notice": "SIMULATION / TEST ENVIRONMENT — NOT INSURANCE. …"
}
```

Codes: `INVALID_EDGE`, `DEPENDENCY_CYCLE`, `UNKNOWN_NODE`, `INVALID_PROVENANCE`,
`INVALID_MONEY`, `INVALID_JURISDICTION`, `AGENT_REQUIRES_PRINCIPAL`,
`AGENT_CHAIN_FORBIDDEN`, `UNKNOWN_NODE_TYPE`, `UNKNOWN_EDGE_TYPE`,
`INVALID_SUBMISSION_TRANSITION`, `NOT_ASSESSED`, `APPROVAL_REQUIRED`,
`STALE_APPROVAL`, `NOT_APPROVED`, `SUBMISSION_NOT_READY`, `ALREADY_LISTED`,
`LISTING_NOT_OPEN`, `CURRENCY_MISMATCH`, `ALREADY_SYNDICATED`,
`SYNDICATION_NOT_OPEN`, `NO_LIVE_INTEREST`, `INVALID_SHARE`,
`DUPLICATE_ALLOCATION`, `OVER_ALLOCATION`, `EXPOSURE_LIMIT_EXCEEDED`,
`ALLOCATION_NOT_FOUND`, `INCOMPLETE_ALLOCATION`, `FORBIDDEN`
(403). Malformed or unknown request fields return `400`; unauthenticated `401`;
missing scope or role `403`.
