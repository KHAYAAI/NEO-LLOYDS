# Neo-Lloyds — Broker Portal

> SIMULATION / TEST ENVIRONMENT — NOT INSURANCE.

The first user-facing surface in this monorepo. Every prior phase (1–11) and
the jurisdiction-modules delivery was API-only, driven by curl/Swagger; this
is the first real UI, and the first thing in this repository to make a
frontend-stack decision at all.

## What it covers

The broker/risk-originator journey end to end, driving the real
`apps/api` service (no mock backend, no duplicated business logic):

1. **Sign in** — paste an API credential (`<keyId>.<secret>`, issued via
   `POST /identity/organisations/:id/credentials`) for an organisation
   holding `RISK_ORIGINATOR` or `BROKER`. Validated by a real call to
   `GET /submissions`, not just checked for shape.
2. **Submit** — creates a `RISK` graph node, then a submission referencing
   it (Phase 2).
3. **Advance** the submission through its state machine
   (`DRAFT → SUBMITTED → ANALYSING → SCORED → READY_FOR_UNDERWRITING`).
4. **AI analyst findings** — read-only, advisory (Phase 2). Degrades to a
   labelled placeholder finding when no `ANTHROPIC_API_KEY` is configured,
   same as the API itself.
5. **Score** the risk with a single risk factor (Phase 2's deterministic
   scoring — a real form, not a stub, though it only submits one factor at a
   time; the API itself accepts an arbitrary array).
6. **Underwriting status** — read-only: the latest assessment if one exists,
   and a live clearance check (`GET /underwriting/risks/:id/clearance`).
   This portal never assesses or approves — that is an `UNDERWRITER`-role
   action, out of scope for a broker/risk-originator credential.
7. **List to marketplace** (Phase 4) — gated by the same clearance check the
   API itself enforces; submitting before clearance is granted fails with
   the API's own `422`, not a portal-side guess.

## Stack, and why

**Next.js (App Router) + React + TypeScript**, chosen over a client-only
Vite SPA because Server Components and Server Actions let every API call —
including the one holding the credential — run server-side. The pasted
credential lives only in an httpOnly session cookie
(`src/lib/session.ts`); it is never sent to the browser as readable
JavaScript, and every `fetch` to `apps/api` happens from a Server
Component/Action (`src/lib/api.ts`), not the client bundle.

No separate login system was built. Authentication reuses the existing
API-key model (`docs/security-model.md` §2) exactly as it already exists —
the portal is a client of that system, not a second one.

## Local development

```bash
npm install
npm -w @neo-lloyds/api run build && npm -w @neo-lloyds/api start   # or start:dev
NEO_LLOYDS_API_URL=http://localhost:3001 npm -w @neo-lloyds/broker-portal run dev
```

Visit `http://localhost:3000` (or whatever port `next dev` binds). You will
need a real credential — run the API's seed script
(`npm -w @neo-lloyds/api run seed`) or issue one via `POST
/identity/organisations/:id/credentials` for an org holding `RISK_ORIGINATOR`
or `BROKER`.

`NEO_LLOYDS_API_URL` defaults to `http://localhost:3001` if unset.

## Deliberately out of scope here

- **Capital provider, corporate, and admin portals** — not started. This
  broker portal establishes the pattern (Next.js App Router, server-side
  credential handling, direct pass-through to `apps/api`); the other three
  should follow it once someone asks for them, not be guessed at now.
- **Underwriting actions** (assess/approve) — `UNDERWRITER`-role
  functionality belongs in a different portal (or an admin surface), not
  bundled into the broker's.
- **A design system.** Styling here (`src/app/globals.css`) is
  intentionally plain, utilitarian CSS — enough to be legible and usable,
  not a component library or brand decision. That is a real decision for
  whoever owns product design, not something to default silently.
