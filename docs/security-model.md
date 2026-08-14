# Neo-Lloyds — Security & Governance Model

> SIMULATION / TEST ENVIRONMENT — NOT INSURANCE.

## 1. Principals

Three kinds of caller: **user** (human, session or credential), **service**
(internal), **agent** (autonomous, always acting under a principal
organisation). Every request resolves to an `AuthContext`:

```
AuthContext { organisationId, subjectId, subjectKind, roles, scopes,
              principalOrganisationId?, mandate? }
```

There is no anonymous mutation path.

## 2. Authentication

Phase 1 uses API credentials: a public key id plus a secret presented as
`Authorization: Bearer <keyId>.<secret>`. Secrets are stored only as a
SHA-256 hash with a per-credential salt; the plaintext is shown once at
creation and never retrievable. Credentials carry scopes, an optional expiry,
and can be revoked, which takes effect immediately.

The `AuthContext` interface is deliberately identical in shape to what an OIDC
session will produce, so introducing OIDC/KYB identity providers later changes
the authenticator, not the authorisation layer.

## 3. Authorisation

Two independent gates, both must pass:

1. **Scope** — what the credential is permitted to do (`graph:read`,
   `graph:write`, `identity:admin`, …).
2. **Market role** — what the organisation is authorised to *be*. Submitting a
   risk requires `RISK_ORIGINATOR` or `BROKER`; assuming risk requires
   `SYNDICATE`. Roles are grants on the organisation, checked server-side, never
   inferred from the request body.

Tenant isolation is a third, non-negotiable check: a caller may only read or
write graph objects owned by its own organisation, unless it holds `REGULATOR`,
whose read access is broad, logged on every access, and never a write.

## 4. AI agent constraints

An agent request is rejected unless **all** hold:

- the agent organisation is active and has a principal;
- the principal's KYB status is `VERIFIED` (in production configuration);
- the requested action is inside the agent's mandate;
- the transaction value is within the mandate ceiling;
- the mandate has not expired.

Agents may **never** bypass KYC/KYB, sanctions screening, capital requirements,
approval controls, jurisdictional restrictions, or human governance. These are
enforced in the authorisation layer, not in agent-facing convenience code, so
there is no separate "agent path" that could drift from the human one.

## 5. Human-in-the-loop thresholds

Configurable per jurisdiction and product:

| Band | Control |
|---|---|
| LOW | automated recommendation, human notified |
| MEDIUM | human underwriter approval |
| HIGH | specialist underwriter approval |
| EXTREME | senior governance approval |

No automated path may bind a legally enforceable obligation. In this prototype
nothing is legally enforceable at all, and every response says so.

## 6. Audit

Append-only. Records actor, timestamp, action, subject, before/after state,
policy applied, decision, reason, and — where a model contributed — model id,
model version and data version. Audit writes participate in the same
transaction as the change they describe: if the audit write fails, the change
fails.

## 7. Data protection

Least-privilege database roles. Evidence in object storage, encrypted, accessed
by pre-signed URL with short expiry. PII minimised in the graph — the graph
holds identifiers, the identity service holds personal data. Jurisdiction
modules declare data-residency requirements (POPIA for South Africa, GDPR for
EU) and the storage layer honours them per-organisation.

## 8. Known gaps in this prototype

Stated plainly rather than papered over: no OIDC, no real KYB/KYC provider, no
sanctions screening integration, no HSM for key material, no rate limiting yet,
and no penetration testing. These are tracked in `docs/roadmap.md` and must be
closed before any non-simulated use.
