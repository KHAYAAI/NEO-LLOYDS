# Phase 10 — Implementation Report

> SIMULATION / TEST ENVIRONMENT — NOT INSURANCE.

**Scope:** Settlement — a `SettlementProvider` interface over bank /
digital-money / stablecoin rails, a configurable fee engine, and a full
transaction record for every operation. This is where Phase 7's claims
"settled" status — a bare state-machine flag, no money moving — finally gets
real transaction infrastructure behind it.
**Status:** Delivered and verified against PostgreSQL, including a live
settlement run with fee calculation confirmed to the cent.

## Where "settled" stops being just a word

Phase 7 shipped `POST /claims/:id/settle`, which does exactly one thing: it
marks a claim `SETTLED`. Its own report said so plainly — "no money moves."
Phase 10 is where that changes, but *narrowly and honestly*: it adds the
transaction infrastructure — a `SettlementTransaction` record, a fee
calculation, a `SettlementProvider` call — without claiming a real bank or
stablecoin rail exists behind it, because none does yet.

## The provider abstraction, and why it has exactly one honest implementation

`SettlementProvider` (`apps/api/src/settlement/providers.ts`) is the same
shape decision Phase 2's `AnalystProvider` made: a narrow interface
(`submit(transactionId, method, amountMinor, currency) →
{providerRef, succeeded}`), with one real implementation shipped —
`NullSettlementProvider` — that simulates instant success and stamps a
transaction reference that unambiguously reads as fake
(`sim-bank_transfer-<id>`, `sim-stablecoin-<id>`, ...), so nothing
downstream could mistake it for a real provider confirmation. `BANK_TRANSFER`,
`DIGITAL_MONEY`, and `STABLECOIN` are settlement *methods* the domain layer
and database recognise — not implementations of a specific bank API, digital
wallet, or blockchain. No cryptocurrency is hard-coded anywhere in this
phase; `STABLECOIN` is a method name a real provider could later implement
against any specific chain or token, exactly like `createAnalystProvider()`
picks a real LLM provider only when a key is configured and otherwise
degrades to the Null provider. Building a fake bank integration here would
be worse than shipping an honest simulated one — the same principle stated
in `docs/security-model.md` §10 for SSO.

## What was built

**`packages/domain/src/settlement.ts`** (pure, zero dependencies):
- `SETTLEMENT_METHODS` / `isSettlementMethod`
- The transaction state machine: `PENDING → {SUBMITTED, FAILED}`,
  `SUBMITTED → {CONFIRMED, FAILED}`, both `CONFIRMED` and `FAILED` terminal
  — `canTransitionSettlement` / `requireSettlementTransition`, same
  discipline as every prior state machine in this system (submissions,
  claims).
- `SettlementFeeConfig` (`flatMinor` + `bps`), `requireValidFeeConfig`,
  `computeSettlementFee` — a flat fee plus a proportional fee, capped so a
  fee can never exceed the amount it's charged against.
- `calculateSettlement` / `settlementSplitIsExact` — `fee + netAmount`
  always equals `grossAmount` exactly, same invariant discipline as
  `allocateMoney` (ADR-0005), `computeClaimPayouts` (Phase 7), and
  `applyReinsuranceProgram` (Phase 9).

12 unit tests in `packages/domain/test/settlement.test.ts`.

**`packages/database`** — one migration (`0010_settlement`):
`SettlementTransaction`, with optional (nullable) links back to a Phase 7
claim payout by claim id and organisation id — a settlement can also be
initiated standalone (e.g. a reinsurance recovery payout), so this is not a
required foreign key.

**`apps/api/src/settlement`** — `POST /settlement/transactions`
(`CLAIMS_ADMINISTRATOR`/`SETTLEMENT_PROVIDER`-only: computes the fee,
records the transaction `PENDING → SUBMITTED`, calls the provider, records
the final `CONFIRMED`/`FAILED` status, audits), `GET
/settlement/transactions/:id`, `GET /settlement/transactions`. The
initiate flow is a single synchronous call chain, appropriate for a
provider that always resolves instantly (the Null provider); a real,
asynchronous provider would instead leave a transaction `SUBMITTED` and a
webhook/poll would confirm it later — the state machine already supports
that without a shape change.

`SettlementRepository` port + `InMemorySettlementRepository` (tests) +
`PrismaSettlementRepository` (production), wired into `app.module.ts` in
both `withPersistence()` and `forRoot()`, alongside a new
`SETTLEMENT_PROVIDER` DI token following the exact `ANALYST_PROVIDER`
pattern.

9 new e2e tests in `apps/api/test/api.e2e.test.ts`: a full bank-transfer
settlement with the fee verified to the cent, a custom fee configuration, a
`STABLECOIN` method run through with no coin/chain assumptions, retrieval,
listing, claim-payout linkage, unknown-method rejection, missing-credential
rejection, and unauthorised-role rejection.

## Verification

| Check | Result |
|---|---|
| `npm test` | 257 passed (236 before this phase → +12 domain, +9 API e2e) |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| One new migration (`0010_settlement`) | applied |
| Live API on PostgreSQL | a full settlement run, fee verified to the cent |

**The live run**: initiated a `BANK_TRANSFER` settlement of $100,000 against
the seeded root organisation (after granting it the `CLAIMS_ADMINISTRATOR`
role, since the seeded MVP scenario's org did not carry it). With the
default fee configuration (`$0.50` flat + `0.25%`), confirmed the fee
computed to exactly **$250.50** (`$0.50 + 0.25% × $100,000 = $0.50 +
$250.00`), net amount **$99,749.50**, and `fee + netAmount` summing back to
the $100,000 gross exactly. The transaction correctly transitioned
`PENDING → SUBMITTED → CONFIRMED`, and the `providerRef`
(`sim-bank_transfer-<id>`) was returned and persisted. Queried the
`SettlementTransaction` row directly in PostgreSQL afterward and confirmed
every field — method, status, gross/fee/net amounts, provider reference —
matched the API response exactly, not just held in memory. `GET
/settlement/transactions` correctly listed the transaction. `POST
/settlement/transactions` without a credential returned `401`.

## External dependencies this phase introduces

None currently active. A real deployment eventually needs at least one of:
a banking-rail integration (e.g. a payments processor with local ZA/UK/EU/US
bank transfer support), a digital-money provider, or a stablecoin custody/
transfer integration — none of which are wired up here, by design (see
above).

## Known gaps carried forward

Unchanged from `docs/security-model.md` §8/§9/§10: no OIDC/SSO, no real
KYB/KYC, no sanctions screening, no HSM, no secrets manager, no penetration
test. Phase-10-specific gaps: no real settlement provider (bank/digital-
money/stablecoin) is integrated — only the Null provider exists; no
reconciliation process against a real provider's transaction ledger; no
automatic wiring from a Phase 7 claim payout or a Phase 9 reinsurance
cession to a settlement transaction — both are supported via the optional
`claimPayoutClaimId`/`claimPayoutOrganisationId` link, but nothing calls
`POST /settlement/transactions` automatically today.

## Next

Phase 11 — AI Agent API: authenticate → submit activity → request
assessment → indicative protection → coverage options → human approval
where required → permitted execution → settlement information. Mandate
enforcement throughout, built on the `AgentMandate`/principal-organisation
machinery already in place since Phase 1.
