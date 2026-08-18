# Jurisdiction Modules — Implementation Report

> SIMULATION / TEST ENVIRONMENT — NOT INSURANCE.

**Scope:** The first deliverable of the roadmap's non-phase-gated
"Continuous" section (`docs/roadmap.md`): jurisdiction modules for South
Africa (first, per ADR-0004), the United Kingdom, the European Union, the
United States, Russia, China, Singapore, and Hong Kong.
**Status:** Delivered and verified against PostgreSQL.

## What "jurisdiction module" means here, precisely

ADR-0004 (`docs/decisions/0004-jurisdiction-modules.md`) states the shape:
the core domain is jurisdiction-neutral, every organisation/risk/policy
carries an explicit jurisdiction with no default, and jurisdiction-specific
rules — capital treatment, KYC/AML, sanctions, tax, data residency,
cross-border — live in modules behind a shared interface. This delivers
exactly that: a new, standalone package (`packages/config`), depending on
nothing and depended on by nothing in `packages/domain` — the core domain
stays exactly as jurisdiction-neutral as ADR-0004 requires, and this package
could be deleted entirely without the core breaking.

## The honesty point, stated as plainly as every other one in this system

Every module publishes five sections: `regulator`, `dataResidency`,
`crossBorder`, `kycAml`, `capitalTreatment`, plus a `citation` and a shared
`disclaimer`. The regulator names and the *shape* of each regime (which
statute governs data protection, whether insurance regulation is
state/national/supranational) are stated as public facts anyone could
verify independently. Every numeric or graded judgement — `KycAmlLevel`
(`STANDARD`/`ENHANCED`), the `crossBorder.permitted` boolean, every
`capitalTreatment.note` — is an illustrative placeholder, explicitly labelled
as such in both the module-level doc comment and every individual module's
`disclaimer` field, which is asserted verbatim in the test suite
(`packages/config/test/jurisdiction.test.ts`) so it can never silently
diverge from module to module. This is the same discipline as Phase 3's
approval thresholds, Phase 7's auto-approval ceiling, and Phase 8's loss
model: a defensible starting shape, never dressed up as calibrated legal or
actuarial advice. Shipping eight modules that *looked* like real compliance
determinations would be worse than shipping none — the same principle
`docs/security-model.md` §10 states for SSO.

## Two modules make a deliberately different claim than the other six

`CN` and `RU` are the only two modules where `dataResidency.requiresLocalStorage`
is `true` and `crossBorder.permitted` is `false` — reflecting China's PIPL/
Data Security Law data-localisation regime and the current sanctions
environment around Russia, respectively. This is not an arbitrary
distinction: it means an integrator calling `GET /jurisdictions/CN` sees a
materially different (and more restrictive) answer than
`GET /jurisdictions/SG`, which is the entire point of building modules
instead of one global "insurance jurisdiction" constant.

## What was built

**`packages/config`** (new package, zero dependencies, mirrors
`packages/domain`'s structure exactly):
- `JurisdictionModule` interface and eight populated modules: `ZA`
  (first, per ADR-0004 — not alphabetical, not the default), `GB`, `EU`,
  `US`, `RU`, `CN`, `SG`, `HK`.
- `EU` is a deliberate, documented exception to "code is ISO-3166-1
  alpha-2": it represents EU-level rules (GDPR, Solvency II, EIOPA)
  distinct from any single member state's national regulator, which a real
  cross-border EU placement must account for at both levels.
- `findJurisdictionModule` / `requireJurisdictionModule` (throws
  `UnknownJurisdictionError`) / `isConfiguredJurisdiction` /
  `listJurisdictionModules` / `SUPPORTED_JURISDICTION_CODES`.
- 11 unit tests: registry coverage, the ZA-first ordering, unconfigured-code
  behaviour (returns `undefined` from the finder, throws from the
  "require" variant), the shared disclaimer asserted verbatim on every
  module, every module's sections non-empty, and the CN/RU data-residency
  distinction.

**`apps/api/src/jurisdiction`** — `GET /jurisdictions` (every module, plus
`supportedCodes`), `GET /jurisdictions/:code` (a single module, `404` if
unconfigured). Both public (no credential required), same reasoning as the
published ontology endpoint (Phase 1): the vocabulary a caller is validated
against should never be hidden behind auth.

**`IdentityService.createOrganisation`** now checks
`isConfiguredJurisdiction` and records the result in the audit trail — but
**never blocks registration**. ADR-0004 requires *a* jurisdiction, not a
*configured* one, and a platform that refused to register an organisation
outside eight hand-built modules would contradict "globally deployable" in
the same breath as claiming it. The gap is surfaced, not hidden: an
organisation registered in an unconfigured jurisdiction gets an audit
record that says so explicitly, and `GET /jurisdictions/:code` returning
`404` is itself the honest signal that no rules are published for that
code yet.

3 new e2e tests for the jurisdiction endpoints, plus 1 confirming the
audit-trail behaviour for an unconfigured jurisdiction (using Brazil as the
example — no module exists for `BR`, deliberately, since building one
without real cause would be scope invented for its own sake).

## Verification

| Check | Result |
|---|---|
| `npm test` | 281 passed (266 before this work → +11 `packages/config`, +4 API e2e) |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| No new migration | none needed — jurisdiction modules are static configuration, not persisted state |
| Live API on PostgreSQL | jurisdiction listing, a single-module fetch (China), a 404 for an unconfigured code, and a live organisation registration in an unconfigured jurisdiction with the audit-trail gap confirmed directly in the database |

**The live run**: `GET /jurisdictions` returned exactly the eight
configured codes, `ZA` first. `GET /jurisdictions/CN` returned the full
China module, correctly showing `dataResidency.requiresLocalStorage: true`
and `crossBorder.permitted: false`. `GET /jurisdictions/BR` returned `404`.
Registered a live organisation with `jurisdiction: "BR"` via `POST
/identity/organisations` — succeeded, exactly as designed — and then
queried the `AuditRecord` table directly in PostgreSQL, confirming the
`reason` column read *"Organisation registered in jurisdiction \"BR\",
which has no configured jurisdiction module yet"* — the gap-flagging
behaviour is a real, persisted fact, not just an in-request response.

## External dependencies this work introduces

None. No new paid or licensed service. (A real deployment into any of
these eight jurisdictions eventually needs a licensed local compliance
review — precisely the gap the disclaimer exists to name.)

## Known gaps

Stated plainly, same as every other section of this project:
- **Not legal advice**, restated because it bears restating: qualified
  local counsel must review any of this before it informs a real decision
  in any jurisdiction.
- **No enforcement wired to the module content yet.** `dataResidency`,
  `kycAml`, and `crossBorder` are published as data — nothing in the
  platform currently *reads* a jurisdiction module to change behaviour
  (e.g. no automatic block on a `crossBorder.permitted: false` transfer, no
  routing of storage to a region based on `requiresLocalStorage`). That
  wiring is real future work, not implied by this delivery.
- **Only eight jurisdictions are configured**, out of however many an
  actually global platform would eventually need. `GET /jurisdictions/:code`
  returning `404` for anything else is the honest state of that gap, not a
  bug to paper over with a generic fallback module (which ADR-0004
  explicitly forbids: there is no default).
- **No sanctions-screening integration** (security-model.md §8) — the
  `kycAml.sanctionsRegimes` field names which lists a real integration
  would need to check, but no such integration exists.

## Portals (broker, capital, corporate, admin)

The roadmap's "Continuous" section also names broker/capital-provider
portals. That is a genuinely different kind of work from everything built
so far — every phase and this jurisdiction-modules delivery has been
backend/API work in an existing NestJS + TypeScript stack; a portal is a
user-facing frontend, and this repository has no frontend framework, build
tooling, design system, or hosting decision made anywhere in it yet.
Building one means choosing a stack (and a first portal to build) that
does not yet have an established convention here — deliberately not
started in this delivery so that choice can be made explicitly rather than
picked implicitly by whichever framework happened to get typed first.
