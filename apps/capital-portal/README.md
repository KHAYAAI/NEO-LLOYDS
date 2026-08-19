# Neo-Lloyds — Capital Provider Portal

> SIMULATION / TEST ENVIRONMENT — NOT INSURANCE.

Follows the exact pattern established by `apps/broker-portal` (Next.js App
Router + React + TypeScript, credential held only in an httpOnly session
cookie, every API call server-side). See that app's README for the shared
rationale; this one covers what's specific to the capital-provider journey.

## What it covers

1. **Sign in** with a `CAPITAL_PROVIDER`-role credential, validated by a
   real `GET /capital/exposure` call.
2. **Browse open listings** (Phase 4) and express non-binding indicative
   interest, or withdraw it.
3. **Set capital appetite** and see it ranked against every open listing
   (Phase 4's deterministic matcher — every non-match states its reasons).
4. **View exposure** (Phase 6): committed / allocated / reserved / available
   capital and utilisation, computed live across every syndication the
   organisation participates in, plus concentration by risk class.

## Deliberately out of scope here

- **Syndication actions** (allocating into a listing, binding) — Phase 5 is
  a separate, higher-stakes workflow with its own invariants (allocations
  summing to exactly 100%, immutable history); it deserves its own
  considered screen, not one bolted onto the appetite/interest flow.
- **Claims and settlement visibility** — a capital provider's exposure to a
  claim belongs conceptually with the corporate/claims-facing portal
  (`apps/corporate-portal`) or a future syndication screen, not duplicated
  here.

## Local development

```bash
npm install
NEO_LLOYDS_API_URL=http://localhost:3001 npm -w @neo-lloyds/capital-portal run dev
```

## WorkOS AuthKit sign-in (optional)

The same "Sign in with WorkOS" path `apps/admin-portal` has, alongside —
not replacing — the paste-a-credential login above. Same
`WORKOS_CLIENT_ID`/`WORKOS_ORGANIZATION_ID` (a shared Neo-Lloyds WorkOS
project/org), same bridge into the existing `nl_credential` cookie. See
`apps/admin-portal/README.md`'s "WorkOS AuthKit sign-in" section for the
full writeup, including what is honestly still unconfirmed (the real
`OIDC_ISSUER_URL` value, and a live browser round-trip — this sandbox has
no network access to workos.com/api.workos.com).
