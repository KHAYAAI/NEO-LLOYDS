# Neo-Lloyds — Admin Portal

> SIMULATION / TEST ENVIRONMENT — NOT INSURANCE.

Follows the exact pattern established by `apps/broker-portal` (Next.js App
Router + React + TypeScript, credential held only in an httpOnly session
cookie, every API call server-side). See that app's README for the shared
rationale.

## What it covers

The `identity:admin`/`identity:read`/`audit:read` operator journey:

1. **Sign in**, validated against `GET /identity/organisations`.
2. **Create organisations**, grant market roles, set KYB status (manual
   decision only — no KYB provider is integrated, and this portal states
   that plainly rather than implying otherwise), and issue API credentials
   (the plaintext secret is shown exactly once, never stored or
   retrievable again — same guarantee the API itself gives).
3. **Browse the audit log** — append-only, newest first.
4. **Browse jurisdiction modules** (`packages/config`) — every field
   labelled with the same illustrative-not-legal-advice disclaimer the API
   itself carries.

## Deliberately out of scope here

- **Claims processing** (advance/loss/decide/settle) — `CLAIMS_ADMINISTRATOR`
  actions were left out of this portal deliberately and now live in their
  own portal, `apps/claims-admin-portal`, rather than being bolted onto
  this one's organisation-management focus. `apps/corporate-portal` covers
  the originator side of a claim.
- **Mandate management** — `POST /identity/mandates` exists and matters
  (Phase 11's AI Agent API), but issuing/reviewing agent mandates is
  security-sensitive enough to deserve its own considered screen rather than
  a quick form bolted onto organisation management.

## Local development

```bash
npm install
NEO_LLOYDS_API_URL=http://localhost:3001 npm -w @neo-lloyds/admin-portal run dev
```

## WorkOS AuthKit sign-in (optional)

An additional, real sign-in path sits alongside the paste-a-credential
login above — it does not replace it. Wired using `@workos-inc/authkit-nextjs`
per WorkOS's own integration guide (`workos/skills`, and
`https://raw.githubusercontent.com/workos/authkit-nextjs/main/README.md`,
fetched and followed directly rather than guessed):

- `src/middleware.ts` — `authkitMiddleware()`, scoped to `/auth/callback`
  only, so it doesn't change how any existing route is protected.
- `src/app/auth/callback/route.ts` — `handleAuth()`, WorkOS's own OAuth
  code exchange, no hand-rolled logic.
- `src/app/auth/bridge/route.ts` — the seam: takes the JWT `accessToken`
  `withAuth()` returns after a successful WorkOS sign-in and stores it in
  the *same* `nl_credential` httpOnly cookie the paste-a-credential path
  uses, so every other page/action in this portal is unchanged.
- `src/app/login/workos-actions.ts` + the "Sign in with WorkOS" button on
  `/login` — only rendered when `WORKOS_CLIENT_ID` is set.

A WorkOS project and organisation named **Neo-Lloyds** already exist
(`project_01M0DMPVXCK558FZPDKNPR9305`, Staging environment
`environment_01M0DMPVXK5JCR5NGQYHDPKGPS`, organisation
`org_01M0DMQZE6GYX4PV7ZPG5JH6QN`) — see `.env.example` for the client id
and organisation id to use. The environment's redirect URI
(`http://localhost:3000/auth/callback`), logout URI
(`http://localhost:3000/login`), and CORS web origin
(`http://localhost:3000`) are configured on it via the WorkOS management
API, not just documented — a real login redirect from a local `next dev`
now has somewhere valid to land.

**What is honestly not done, and why it can't be from here:**

1. **`apps/api`'s `OIDC_JWKS_URL` is now known and set correctly** — read
   directly out of the installed `@workos-inc/node` SDK's own source
   (`UserManagement.getJwksUrl`), not guessed:
   `https://api.workos.com/sso/jwks/client_01M0DMPW9VVWVXC5PZHAEW6S2K`
   (see the root `.env.example`). **`OIDC_ISSUER_URL` is still not set to
   a confirmed real value.** WorkOS's own SDK verifies its AuthKit access
   tokens by signature only — no `iss` claim check in its reference
   implementation — so there was no ground-truth source in this sandbox
   (no network access to `workos.com`/`api.workos.com` to decode a real
   token) to confirm what string the issuer check in
   `apps/api/src/common/oidc.ts` should require. **Decode one real
   AuthKit access token's `iss` claim** (sign in once, inspect
   `withAuth()`'s `accessToken`) and set `OIDC_ISSUER_URL` to that exact
   value before relying on this path — an unconfirmed guess there would
   reject every real WorkOS token, which is worse than leaving it unset.
2. **No `POST /identity/organisations/:id/oidc-users` call has been made**
   for any real WorkOS user yet — an admin must still explicitly link a
   signed-in person's WorkOS `sub` claim to a Neo-Lloyds organisation
   before their sign-in resolves to anything (§10: no self-registration).
3. **The full browser round-trip (click "Sign in with WorkOS" → real
   WorkOS-hosted login page → callback → bridge → dashboard) has not been
   live-verified**, for the same network-access reason as (1) — every
   other feature in this repository was verified with a real headless
   browser against the real running stack before being called done; this
   one could not be, and is not being claimed as done in that sense.
   Test it in an environment with network access to WorkOS before relying
   on it.
