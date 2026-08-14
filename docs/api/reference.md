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
`AGENT_CHAIN_FORBIDDEN`, `UNKNOWN_NODE_TYPE`, `UNKNOWN_EDGE_TYPE`, `FORBIDDEN`
(403). Malformed or unknown request fields return `400`; unauthenticated `401`;
missing scope or role `403`.
