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
and organisation id to use.

**What is honestly not done, and why it can't be from here:**

1. **`apps/api`'s `OIDC_ISSUER_URL`/`OIDC_JWKS_URL` (see the root
   `.env.example` and `docs/security-model.md` §10) are not set to
   WorkOS's real values.** This sandbox has no network access to
   `workos.com` or `api.workos.com` — every fetch attempt was blocked at
   the egress proxy — so the exact AuthKit issuer/JWKS URL for this
   environment could not be confirmed against WorkOS's actual API or
   docs site, only against their GitHub-hosted SDK README (which does not
   document it). **Get these two values from the WorkOS dashboard**
   (Neo-Lloyds project → Staging → the SSO/AuthKit configuration page)
   before this sign-in path can actually authenticate against the real
   `apps/api`, and set them there. Until then, `/auth/bridge` will
   complete, but the Neo-Lloyds API will reject the forwarded token with
   `401 Invalid OIDC token`.
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
