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

Stated plainly rather than papered over: no real KYB/KYC provider, no
sanctions screening integration, no HSM for key material, no secrets
manager, no penetration testing, no real reinsurer counterparty, no
regulatory licensing, and settlement still has exactly one implementation
(`NullSettlementProvider` — no real money moves). These are tracked in
`docs/roadmap.md` and must be closed before any non-simulated use.
**OIDC/SSO login is the one item that moved off this list** — §10 covers
what is now real and what is still an external dependency. §9 records what
has been closed as of the hardening pass in this section's changelog.

None of the remaining items are closable by more code alone:

- **KYB/KYC and sanctions screening** need a signed contract with a vendor
  (e.g. Onfido, ComplyAdvantage, Refinitiv World-Check) and their live API
  credentials. The honest next step, mirroring how `SettlementProvider`
  (§9 of `docs/reports/phase-10.md`) and `AnalystProvider` are already
  built, is a `KybProvider`/`SanctionsProvider` interface with a `Null`
  implementation for tests and a real adapter behind it — not something to
  build speculatively against a vendor with no account to test against.
- **An HSM/secrets manager** (AWS KMS/Secrets Manager, HashiCorp Vault,
  GCP Secret Manager) is an infrastructure choice tied to wherever this is
  actually deployed; picking one before a deployment target exists would be
  guessing.
- **A penetration test** requires an independent third party attacking a
  running instance — not something achievable inside this repository.
- **A real reinsurer counterparty and regulatory licensing** are legal and
  business processes, not engineering ones, and Neo-Lloyds is explicitly
  a technology prototype, not a licensed entity, until that happens.

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

**Updated: an OIDC authenticator is now real code**, not just a shape
`AuthContext` was left ready for. `ApiCredentialGuard.resolve`
(`apps/api/src/common/auth.ts`) now has two paths: the original
`<keyId>.<secret>` machine credential (§2, unchanged), and an OIDC ID token
— distinguished by dot count in the bearer token (one dot vs. the three
segments of a JWT). Set `OIDC_ISSUER_URL` (see `.env.example`) and it is
live: real signature verification against the issuer's JWKS, real issuer
and audience checks, real expiry enforcement (`apps/api/src/common/oidc.ts`,
via `jose` — the same library, doing the same cryptographic checks, that a
production OIDC client would use). Unset, the bearer guard behaves exactly
as before this was added.

An admin links a human to an organisation with
`POST /identity/organisations/:id/oidc-users` (`identity:admin`, mirrors
credential issuance) — `email`, `displayName`, `scopes`, and the verified
`oidcIssuer`/`oidcSubject` pair, stored on the previously-unused `User`
table. A verified token for an unlinked subject is rejected exactly like an
unknown API key is — there is no self-registration and no automatic role
inference from IdP claims. `apps/api/test/oidc-auth.test.ts` proves the
full path: a real RS256 key pair, a real signed token, an accepted linked
subject, and rejections for an unlinked subject, wrong audience, and
expired token.

**What is honestly still missing — this is now an integration problem, not
a coding problem:**

1. **A real, registered identity provider.** The verifier works against any
   spec-compliant OIDC issuer, but no Okta/Azure AD/Google Workspace tenant
   is registered for this project, so it has never been exercised against
   a real IdP's actual login screen and consent flow — only against a
   locally-generated key pair in tests and a live-but-synthetic run during
   development (`OIDC_JWKS_STATIC_JSON`, documented as dev/test-only in
   `.env.example`). Which provider(s) to certify against first is a
   partner/procurement decision, not an engineering one.
2. **No browser-side login flow (Authorization Code + PKCE, redirect,
   callback, session cookie issuance) exists in any portal.** What's built
   is the *server-side token verification* half — the piece that would sit
   behind such a flow. A portal's browser-based "Sign in with your identity
   provider" button is a separate, real chunk of work this change
   deliberately did not fabricate, because it cannot be tested honestly
   without a registered OIDC client redirect URI at a real provider.
3. **Identity federation/provisioning (SCIM)**, so an enterprise customer's
   directory groups and offboarding automatically map onto Neo-Lloyds users
   and roles, instead of an admin manually calling
   `POST .../oidc-users` per person. Today, exactly like a manual role
   grant, revocation is a manual admin action (there is no `revokeUser`
   endpoint yet either — deactivating a `User` row directly is the only
   path).
4. **MFA**, delegated entirely to whichever IdP is eventually integrated —
   this was always the reason to prioritise OIDC over a local
   username/password system, and remains true now that the authenticator
   exists.

The distinction that matters: before this change, *nothing* here was
cryptographically real about OIDC. Now the hard cryptographic part — token
verification — is real and tested. What remains is connecting it to an
actual identity provider account and building the browser flow around it,
neither of which this repository can fabricate without misrepresenting
what's been verified.
