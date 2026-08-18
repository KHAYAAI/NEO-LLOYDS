# Phase 11 — Implementation Report

> SIMULATION / TEST ENVIRONMENT — NOT INSURANCE.

**Scope:** AI Agent API — authenticate → submit activity → request
assessment → indicative protection → coverage options → human approval
where required → permitted execution → settlement information, with mandate
enforcement throughout.
**Status:** Delivered and verified against PostgreSQL, including a live
mandate-ceiling rejection.

## What this phase actually adds

Every step in the flow above already existed as a service before this
phase: `SubmissionService`, `AnalystService`, `UnderwritingService`,
`MarketplaceService`, `SettlementService`. Phase 11 does not reimplement any
of them — `AgentService` (`apps/api/src/agent/agent.service.ts`) delegates
every step to the exact service a human caller uses for the same action.

What Phase 11 actually adds is one thing: a real, live call to
`assertAgentMayAct` (`packages/domain/src/identity.ts`) before every step.
That function has existed since **Phase 1** — it checks a mandate exists,
resolves to a known active principal, requires KYB verification in
production configuration, has not expired, permits the specific action
requested, and keeps the requested value within the mandate's transaction
ceiling — and it has been unit-tested since Phase 1
(`packages/domain/test/invariants.test.ts`). But nothing in Phases 1–10 ever
called it from a live request path. An agent credential could authenticate,
its mandate was resolved into `AuthContext.mandate` by `ApiCredentialGuard`,
and then... nothing read it. Phase 11 closes that gap: it is the first
phase where an agent's mandate is actually enforced against a real
committed action, not just modelled and tested in isolation.

## The load-bearing check

`AgentService.permittedExecution` is the one step where this matters in
a way that would actually stop money-adjacent behaviour: it checks the
requested `indicativeAmount` against `mandate.maxTransactionValueMinor`
*before* `MarketplaceService.expressInterest` ever runs. The live
verification below proves this ordering, not just the shape of the check:
a request over the mandate ceiling is rejected `403` without ever reaching
the listing lookup.

## Why the same routes work for a human caller too

`assertAgentMayAct` is a documented no-op when `ctx.subjectKind !== 'AGENT'`
(security-model.md §4: "there is no separate agent path that could drift
from the human one"). Every `/agent/*` route in this phase honours that —
a human/service credential calling `/agent/activity` behaves exactly like
calling `/submissions` directly, with no mandate gate in the way. This
symmetry is deliberate: introducing agent-only routes with agent-only
authorisation logic would be exactly the kind of parallel path the security
model explicitly forbids.

## What was built

**No new `packages/domain` module.** This phase is intentionally almost
entirely wiring: `assertAgentMayAct`, `mayProceedWithoutHuman`, and the
`ApprovalBand`/`AgentMandate` types it depends on were all built and tested
in Phase 1. Writing a second domain module here to have "phase 11 domain
code" would be inventing scope the task doesn't need — the honest report is
that this phase's job was to *use* what Phase 1 built, not duplicate it.

**`apps/api/src/agent`**:
- `agent.service.ts` — `mandateCheck` (resolves the caller's principal via
  `IdentityRepository`, calls `assertAgentMayAct`, and — only for actual
  agents — records an `agent.mandate.check` audit entry) followed by seven
  step methods, each a thin call into an existing service after the check:
  `submitActivity`, `requestAssessment`, `indicativeProtection`,
  `coverageOptions`, `permittedExecution`, `settlementInformation`.
- `indicativeProtection` is the one method with real logic of its own: it
  fetches the existing underwriting assessment (Phase 3) and additionally
  attempts `requireClearance`, catching and reporting the specific
  `DomainError` if it is not currently clear to proceed — the response is
  explicitly labelled `indicative: true` with a `disclosure` field stating
  plainly that it is not a binding offer, and it creates or approves
  nothing.
- `agent.controller.ts` — `POST /agent/activity`, `GET
  /agent/risks/:id/assessment`, `GET /agent/risks/:id/indicative-protection`,
  `GET /agent/coverage-options`, `POST
  /agent/coverage-options/:listingId/execute`, `GET
  /agent/settlement/:transactionId`.

No new persistence port, migration, or repository — every read/write this
phase performs already goes through an existing repository via the service
it delegates to.

11 new e2e tests in `apps/api/test/api.e2e.test.ts`, most bootstrapping a
real `AI_AGENT` organisation with a real mandate via the existing
`/identity/organisations` and `/identity/mandates` endpoints (not a
shortcut fixture): a mandated agent successfully submitting activity, an
action outside the mandate's permitted actions rejected, indicative
protection surfaced without binding anything, coverage options listed, the
mandate ceiling enforced on execution (both the over-ceiling rejection and
the within-ceiling success), an expired mandate rejected, a credential with
no mandate at all rejected, and confirmation that a human/service caller
uses the identical routes with no mandate gate in the way.

## Verification

| Check | Result |
|---|---|
| `npm test` | 266 passed (257 before this phase → +11 API e2e; no new domain tests, per the "no new domain module" note above) |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| No new migration | none needed |
| Live API on PostgreSQL | mandate creation, a mandated agent's activity submission, and a live mandate-ceiling rejection, all verified live |

**The live run**: created a real `AI_AGENT` organisation with
`Neo-Lloyds Platform Operations` as its principal, issued it an `AGENT`
credential, and created a real mandate (`maxTransactionValueMinor: $500`,
permitting `activity.submit`/`risk.assess`/`protection.indicative`/
`coverage.browse`/`coverage.bind`/`settlement.read`) via `POST
/identity/mandates`. Using the agent's own credential: created a RISK node,
then called `POST /agent/activity` — succeeded, and the resulting
submission's `organisationId` correctly matched the agent's own
organisation. `GET /agent/coverage-options` succeeded read-only. Then
attempted `POST /agent/coverage-options/:id/execute` with
`indicativeAmountMinor: 60000` ($600) against the $500 mandate ceiling —
correctly rejected `403`, and confirmed via the request flow that this
happens *before* any listing lookup (the listing id used did not even
exist, and the response was still the mandate rejection, not a 404 — proof
the ceiling check runs first). `POST /agent/activity` without a credential
returned `401`.

## External dependencies this phase introduces

None. No new paid or licensed service.

## Known gaps carried forward

Unchanged from `docs/security-model.md` §8/§9/§10: no OIDC/SSO, no real
KYB/KYC provider, no sanctions screening, no HSM, no secrets manager, no
penetration test — all of which matter more here than in prior phases,
since `assertAgentMayAct`'s `requireVerifiedPrincipal` check (enforced in
production configuration) depends on a real KYB determination this
prototype does not have. Phase-11-specific gaps: `coverageOptions` is a
thin pass-through to `MarketplaceService.browseListings` with no
agent-specific ranking, filtering by mandate scope, or explanation of why a
listing is or isn't a good match — an agent today sees the same open-listing
list a human broker would browse manually. There is also no automatic
wiring from `permittedExecution` through to `settlementInformation` — an
agent can check a settlement transaction's status once one exists, but
nothing in this phase creates that transaction from an agent action; that
remains a human/administrative step via Phase 10's endpoints.

## Next

The eleven numbered phases from `docs/roadmap.md` are now all delivered.
What remains, per the roadmap's "Continuous" section, is not phase-gated:
jurisdiction modules (South Africa first, then UK/EU/US), and the broker /
capital-provider portals.
