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

Stated plainly rather than papered over: no SSO/OIDC login, no real KYB/KYC
provider, no sanctions screening integration, no HSM for key material, no
secrets manager, no penetration testing. These are tracked in
`docs/roadmap.md` and must be closed before any non-simulated use. §9 records
what has been closed as of the hardening pass in this section's changelog,
and §10 gives the honest answer on SSO specifically, since it is the gap
most often asked about and least substitutable by more code alone.

## 9. Hardening applied (production baseline)

Applied directly to `apps/api/src/main.ts` and `app.module.ts`, verified live
against PostgreSQL (headers, CORS allow/deny, and rate-limit enforcement all
confirmed by hand, not just asserted):

- **Security headers** (`helmet`): a strict default Content-Security-Policy
  (`default-src 'self'`), `X-Frame-Options: SAMEORIGIN`,
  `X-Content-Type-Options: nosniff`, HSTS, and `X-Powered-By` removed. Safe to
  apply globally because this is a JSON API with a Swagger UI, not a page that
  serves third-party scripts.
- **CORS is same-origin-by-default.** No cookie-based session exists (see §2:
  bearer credentials only), so `credentials: true` is never needed and
  cross-origin browser access is denied unless the caller's origin is
  explicitly listed in `CORS_ALLOWED_ORIGINS`. This has no effect on
  server-to-server callers — CORS is a browser-enforced mechanism only, and a
  risk-marketplace API's primary integration path is server-to-server.
- **IP-based rate limiting**, in front of the auth guard (`@nestjs/throttler`,
  configurable via `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX_REQUESTS`). This
  is what makes a credential-guessing loop expensive rather than free — it
  caps request volume before a single secret comparison happens, not after.
- **Request size limits** (256 KB JSON body cap) — an unauthenticated
  large-body request is rejected before it reaches validation or a handler.
- **`trust proxy` explicitly configured** for correct client-IP resolution
  behind a load balancer, which the rate limiter's IP keying depends on.
- **Failed-auth logging.** Every rejected credential, missing scope, and
  missing role now logs a structured WARN with the presented key id (never
  the secret) — the minimum signal an operator needs to notice a
  credential-stuffing attempt before it succeeds. The client-facing message
  stays uniform (`Invalid credential` for both an unknown key and a wrong
  secret) so a caller can never distinguish the two; only the server-side log
  is more specific.
- **Swagger/OpenAPI is opt-in in production** (`ENABLE_API_DOCS=true`
  required when `NODE_ENV=production`) rather than published by default — the
  full request/response schema, including every internal error code, is
  useful to integrators and not something to expose unauthenticated on a
  production origin without a decision to do so.

None of this closes §8's gaps — it closes what is closable without an
external dependency. Rate limiting, headers and CORS are configuration;
SSO, KYB, sanctions screening and a penetration test are not.

## 10. SSO / enterprise identity — the honest answer

There is currently **no SSO login** — no OIDC, no SAML, no "Sign in with
your identity provider." What exists is machine credentials (§2): a
`keyId`/`secret` pair, suitable for API integrations and for the broker/
capital-provider portals once they exist, but not for a human logging in
through an enterprise identity provider (Okta, Azure AD, Google Workspace).

This is not an oversight, and it is also not purely a coding task:

**What is already in place for it.** `AuthContext` (§1) was deliberately
shaped to match what an OIDC session produces — `organisationId`,
`subjectId`, `roles`, `scopes` — specifically so that adding OIDC later
replaces the *authenticator* (`ApiCredentialGuard.resolve`) without touching
a single authorisation check downstream. Every `RequireScopes`/`RequireRoles`
decorator, every `requireTenantAccess` call, every audit record — all of it
is already written against the interface an SSO session would also produce.

**What SSO actually requires, and why none of it can be simulated
honestly:**

1. **A real identity provider relationship.** SSO means integrating against
   *someone's* IdP — Okta, Azure AD, Google Workspace, or a generic OIDC/SAML
   provider a customer already runs. That is a partner/procurement decision
   for you to make (which protocol to support first, which providers to
   certify against), not something a codebase can pre-select.
2. **Session and token infrastructure this API doesn't have yet:** an OIDC
   redirect/callback flow, ID token verification against the provider's
   JWKS, refresh-token handling, and a session store (Redis is already in
   the stack for this reason but unused so far).
3. **Identity federation and provisioning**, so an enterprise customer's
   directory groups map onto Neo-Lloyds market roles — typically SCIM for
   automated user provisioning/deprovisioning, which matters operationally
   (an employee who leaves a customer's company should lose access the
   moment their IdP account is disabled, not whenever someone remembers to
   revoke a Neo-Lloyds credential by hand).
4. **MFA**, generally delegated to the IdP rather than reimplemented, which
   is itself a reason to prioritise SSO over a local username/password system
   — building local MFA would be strictly worse than integrating an IdP that
   already provides it.

**What I would build, in order, once a target IdP is chosen:** an
`OidcAuthProvider` implementing the same shape `ApiCredentialGuard` already
produces; token verification against the provider's JWKS with caching;
a `UserSession` concept distinct from `ApiCredential` (§2's machine
credentials keep working unmodified — they are a different principal kind,
not something SSO replaces); and a role-mapping configuration so a
customer's IdP groups translate into Neo-Lloyds market roles per
organisation, auditable the same way a manual role grant is today.

None of that is buildable honestly without a real IdP to integrate against —
which is why it isn't stubbed out with fake OIDC endpoints here. A fake SSO
flow would be worse than no SSO flow: it would look done when it isn't.
