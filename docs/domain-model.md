# Neo-Lloyds — Domain Model

> SIMULATION / TEST ENVIRONMENT — NOT INSURANCE.

## 1. Identity

### Organisation
An organisation is a legal entity or a principal-operated autonomous system.

```
Organisation
  id, legalName, jurisdiction (ISO-3166-1 alpha-2), kind, status,
  kybStatus: UNVERIFIED | PENDING | VERIFIED | REJECTED
  roles: MarketRole[]
```

`kind` ∈ `COMPANY | INDIVIDUAL | AI_AGENT | REGULATOR`.

### MarketRole
The nine market functions, granted explicitly and independently:

`RISK_ORIGINATOR · BROKER · UNDERWRITER · SYNDICATE · CAPITAL_PROVIDER ·
REINSURER · INSURER · CLAIMS_ADMINISTRATOR · SETTLEMENT_PROVIDER · REGULATOR`

An organisation holding both `BROKER` and `UNDERWRITER` is representable, and
that is intentional — such conflicts exist in real markets — but each is a
separate grant, separately auditable, and the governance layer can forbid a
combination per jurisdiction.

### AI agents are not principals
An `AI_AGENT` organisation **must** have a `principalOrganisationId`. Legal
responsibility rests with the principal. An agent has a *mandate*: permitted
actions, transaction ceiling, and expiry. Nothing an agent does can exceed its
mandate, and the mandate can never exceed its principal's own authority.

### User, ApiCredential, AuditRecord
Users belong to an organisation and hold role grants scoped to it.
API credentials are hashed at rest (never stored in plaintext), carry explicit
scopes, and may be revoked. Every mutation writes an append-only `AuditRecord`
of `{actor, action, subjectType, subjectId, at, before, after, reason}`.

## 2. Risk ontology

### Node types
`ENTITY · ASSET · DEPENDENCY · RISK · HAZARD · EXPOSURE · EVENT · LOSS ·
POLICY · COVERAGE · PREMIUM · CLAIM · CAPITAL · SYNDICATE ·
REINSURANCE_CONTRACT · SETTLEMENT`

### Edge types and their legal endpoints

| Edge | From | To |
|---|---|---|
| `OWNS` | ENTITY | ASSET |
| `DEPENDS_ON` | ASSET | ASSET |
| `EXPOSED_TO` | ENTITY | RISK |
| `MAY_CAUSE` | RISK | EVENT |
| `MAY_CAUSE` | EVENT | LOSS |
| `COVERS` | POLICY | RISK |
| `SUPPORTS` | CAPITAL | SYNDICATE |
| `ASSUMES` | SYNDICATE | RISK |
| `PROTECTS` | REINSURER (ENTITY) | SYNDICATE |
| `REPRESENTS` | CLAIM | LOSS |
| `PAYS` | SETTLEMENT | CLAIM |

The endpoint table is **data**, not scattered `if` statements: `edgeRules` in
`packages/domain` is the single authority, and edge creation is rejected if the
pair is not listed. This is what stops the graph from silently becoming a soup
of untyped links.

`DEPENDS_ON` is acyclic. Cycle creation is rejected — a dependency cycle makes
"what fails if X fails" non-terminating and is almost always a data error.

### Provenance
Every node and edge carries:

```
Provenance { sourceId, sourceKind, observedAt, recordedAt,
             confidence: 0..1, transformations: string[] }
```

`sourceKind` ∈ `USER_DECLARED | DOCUMENT | EXTERNAL_FEED | SENSOR | DERIVED |
AI_INFERRED`. `AI_INFERRED` additionally requires `modelId` and `modelVersion`.
An `AI_INFERRED` node is never treated as verified: consumers that require
verified inputs filter on `sourceKind`, and the graph API exposes that filter
directly.

### Money and uncertainty
Money is `{ amountMinor: bigint-safe integer, currency: ISO-4217 }`. Never a
float. Never mixed currencies in one sum without an explicit, provenanced FX
rate.

Estimates are `{ value, confidence, basis }` or `{ low, expected, high,
confidence }`. There is no type in the domain that represents a naked estimate.

## 3. The six graph questions

The risk graph exists to answer these, and each has a named domain function:

1. **What can fail?** — assets and risks reachable from an entity.
2. **What does it depend on?** — transitive `DEPENDS_ON` closure of an asset.
3. **What entities are exposed?** — reverse traversal from a risk/event.
4. **What losses could result?** — `RISK → EVENT → LOSS` chains.
5. **Which policies cover the exposure?** — `POLICY -COVERS→ RISK`.
6. **Which capital bears it?** — `CAPITAL → SYNDICATE -ASSUMES→ RISK`,
   plus `REINSURER -PROTECTS→ SYNDICATE`.
7. **What correlates?** — entities sharing a dependency or hazard, which is the
   input to concentration limits and to AI-catastrophe modelling later.

## 4. Later-phase entities (specified, not yet built)

Underwriting assessment, market listing, syndication allocation (with the
total = 100% invariant and immutable allocation history), capital ledger
positions, reinsurance layers, parametric triggers (kept strictly separate from
indemnity claims logic), claims, settlement instructions and adapters, fee
schedules. Defined in `docs/roadmap.md`; each arrives with its own migration,
tests and API docs.
