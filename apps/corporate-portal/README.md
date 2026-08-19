# Neo-Lloyds — Corporate Portal

> SIMULATION / TEST ENVIRONMENT — NOT INSURANCE.

Follows the exact pattern established by `apps/broker-portal` (Next.js App
Router + React + TypeScript, credential held only in an httpOnly session
cookie, every API call server-side). See that app's README for the shared
rationale.

## What it covers

The risk-originator/broker claims journey (Phase 7):

1. **Sign in** with a `RISK_ORIGINATOR`/`BROKER`-role credential.
2. **Report a claim** — an incident against a `BOUND` syndication.
3. **Look up a claim by id** and track its status, attach evidence, and see
   any recorded payouts once approved.

There is deliberately no "list my claims" screen: the API has no endpoint
for it (only `GET /claims/:id` and `GET /claims/by-syndication/:id`), and
this portal reflects what the API actually supports rather than inventing a
list view the backend can't back.

## Deliberately out of scope here

- **Claim processing actions** — advance, calculate loss, decide, settle —
  are all `CLAIMS_ADMINISTRATOR`-only. That is an admin-portal
  (`apps/admin-portal`) concern, not a corporate/originator one; a real
  claims administrator is a different user, with different training and
  accountability, from the company reporting the loss.

## Local development

```bash
npm install
NEO_LLOYDS_API_URL=http://localhost:3001 npm -w @neo-lloyds/corporate-portal run dev
```
