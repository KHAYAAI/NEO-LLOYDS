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
