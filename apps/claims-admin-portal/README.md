# Neo-Lloyds — Claims Administrator Portal

> SIMULATION / TEST ENVIRONMENT — NOT INSURANCE.

The fifth portal, and the one that closes a gap the other four left open:
`CLAIMS_ADMINISTRATOR` actions (advance/loss/decide/settle) existed in
`apps/api/src/claims` since Phase 7 but were API-only — no UI exposed them.
Same stack, same pattern as every other portal here
(`apps/broker-portal/README.md`): Next.js App Router, credential in an
httpOnly session cookie, every call server-side, no separate login system.

## What it covers

1. **Sign in** — a `CLAIMS_ADMINISTRATOR` credential with the
   `claims:read`, `claims:process`, `claims:approve` and `claims:settle`
   scopes. Validated against `GET /claims/by-syndication/:id` with a
   syntactically-plausible but certainly-nonexistent id, reading the *class*
   of the response rather than picking an unrelated endpoint: a 404 means
   the credential authenticated and the guard let the request through to
   business logic; a 401/403 means it didn't. (`apps/capital-portal`'s
   README documents the earlier, cruder version of this bug — an endpoint
   that legitimately 404s for a *valid* credential in a particular business
   state.)
2. **Find a claim** — there is no "list all claims" endpoint, only
   `GET /claims/by-syndication/:syndicationId` and `GET /claims/:id`; this
   is a direct id lookup, same honesty as the corporate portal's claim
   lookup.
3. **Advance** a claim through `REPORTED → EVIDENCE_COLLECTED → VERIFIED →
   COVERAGE_CONFIRMED` (the last step requires the syndication to be BOUND).
4. **Calculate loss** — the coverage test: claimed loss checked against the
   syndication's bound capacity net of every prior approved/settled claim,
   then classified `AUTO` (paid immediately) or `HUMAN_REVIEW`.
5. **Decide** a claim `AWAITING_APPROVAL` — approve or reject, with a
   reason.
6. **Settle** an `APPROVED` claim. This calls the same test settlement
   infrastructure every other portal's settlement path calls — see
   `docs/reports/phase-7.md` and `docs/security-model.md` §8: the only
   `SettlementProvider` implementation is `NullSettlementProvider`. No real
   money moves.
7. **Payouts** — read-only, each capital provider's exact share.

## Local development

```bash
npm install
npm -w @neo-lloyds/api run build && npm -w @neo-lloyds/api start
NEO_LLOYDS_API_URL=http://localhost:3001 npm -w @neo-lloyds/claims-admin-portal run dev
```

You will need a credential for an organisation holding `CLAIMS_ADMINISTRATOR`
with the four `claims:*` scopes above — issue one via the admin portal
(`apps/admin-portal`) or `POST /identity/organisations/:id/credentials`.

## Deliberately out of scope here

- **Reporting a claim or attaching evidence** — that is the risk
  originator/broker's action (`apps/corporate-portal`), not the
  administrator's.
- **Real settlement.** This portal calls the same fake `settle` endpoint
  every other client does. A real bank/stablecoin/payment-rail integration
  is not built anywhere in this repository yet.

## WorkOS AuthKit sign-in (optional)

The same "Sign in with WorkOS" path `apps/admin-portal` has, alongside —
not replacing — the paste-a-credential login above. Same
`WORKOS_CLIENT_ID`/`WORKOS_ORGANIZATION_ID` (a shared Neo-Lloyds WorkOS
project/org), same bridge into the existing `nl_credential` cookie. See
`apps/admin-portal/README.md`'s "WorkOS AuthKit sign-in" section for the
full writeup, including what is honestly still unconfirmed (the real
`OIDC_ISSUER_URL` value, and a live browser round-trip — this sandbox has
no network access to workos.com/api.workos.com).
