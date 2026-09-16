/**
 * The `KybProvider`/`SanctionsProvider` ports docs/security-model.md §8
 * calls for: "a `KybProvider`/`SanctionsProvider` interface with a `Null`
 * implementation for tests and a real adapter behind it — not something to
 * build speculatively against a vendor with no account to test against."
 * Same shape and same honesty rule as `SettlementProvider`
 * (apps/api/src/settlement/providers.ts) and `AnalystProvider`
 * (apps/api/src/analyst/providers.ts): degrade to a clearly labelled no-op,
 * never fabricate a result.
 *
 * Wiring a real vendor (Onfido, ComplyAdvantage, Refinitiv World-Check,
 * etc.) later means writing one adapter class per interface and pointing
 * `createKybProvider`/`createSanctionsProvider` at it when an API key is
 * configured — nothing above this port changes, exactly like adding a real
 * `SettlementProvider` wouldn't touch `SettlementService`.
 *
 * Critical distinction from an authorisation-bearing check: neither
 * provider's result is treated as a decision anywhere in this codebase.
 * `IdentityService.runComplianceChecks` records what a provider reports;
 * only the existing, unchanged `setKybStatus` (an explicit admin action)
 * changes an organisation's `kybStatus`. A `NullSanctionsProvider` hit list
 * of `[]` must never be read as "screened clean" — see `screened` below.
 */

import {
  createDiditKybProviderFromEnv,
  createDiditSanctionsProviderFromEnv,
  createDiditVerificationSessionProviderFromEnv,
  createDiditWalletScreeningProviderFromEnv,
} from './didit.js';

export type KybVerdict = 'NOT_INTEGRATED' | 'VERIFIED' | 'REJECTED' | 'REQUIRES_REVIEW';

export interface KybCheckResult {
  readonly providerId: string;
  readonly verdict: KybVerdict;
  readonly reference?: string;
  readonly checkedAt: string;
}

export interface KybProvider {
  readonly providerId: string;
  check(input: { organisationId: string; legalName: string; jurisdiction: string }): Promise<KybCheckResult>;
}

export interface SanctionsHit {
  readonly listName: string;
  readonly matchedName: string;
  readonly score: number;
}

export interface SanctionsScreeningResult {
  readonly providerId: string;
  /**
   * false for a provider that did not actually screen anything (the null
   * provider). An empty `hits` array only means "cleared" when this is
   * true — callers must check both fields, never `hits.length === 0` alone.
   */
  readonly screened: boolean;
  readonly hits: readonly SanctionsHit[];
  readonly screenedAt: string;
}

export interface SanctionsProvider {
  readonly providerId: string;
  screen(input: { organisationId: string; legalName: string }): Promise<SanctionsScreeningResult>;
}

export class NullKybProvider implements KybProvider {
  readonly providerId = 'null-provider';

  async check(): Promise<KybCheckResult> {
    return {
      providerId: this.providerId,
      verdict: 'NOT_INTEGRATED',
      checkedAt: new Date().toISOString(),
    };
  }
}

export class NullSanctionsProvider implements SanctionsProvider {
  readonly providerId = 'null-provider';

  async screen(): Promise<SanctionsScreeningResult> {
    return {
      providerId: this.providerId,
      screened: false,
      hits: [],
      screenedAt: new Date().toISOString(),
    };
  }
}

/**
 * Wiring order: a real Didit adapter first (apps/api/src/compliance/didit.ts,
 * built against live sandbox calls through Didit's own MCP connector), then
 * the same fail-loudly guard as before for any other vendor whose key got
 * set without an adapter to match. An operator who set a real key is trying
 * to turn real screening on, and a quiet no-op would be a worse failure
 * mode than a startup error (the same "no opinion beats a made-up opinion"
 * reasoning ADR-0006 applies to the AI analyst applies here).
 */
export function createKybProvider(): KybProvider {
  const didit = createDiditKybProviderFromEnv();
  if (didit) return didit;

  if (process.env['KYB_PROVIDER_API_KEY']) {
    throw new Error(
      'KYB_PROVIDER_API_KEY is set, but no real KybProvider adapter is implemented yet ' +
        '(docs/security-model.md §8). Unset it to use NullKybProvider, or implement an ' +
        'adapter class and wire it in here.',
    );
  }
  return new NullKybProvider();
}

export function createSanctionsProvider(): SanctionsProvider {
  const didit = createDiditSanctionsProviderFromEnv();
  if (didit) return didit;

  if (process.env['SANCTIONS_PROVIDER_API_KEY']) {
    throw new Error(
      'SANCTIONS_PROVIDER_API_KEY is set, but no real SanctionsProvider adapter is ' +
        'implemented yet (docs/security-model.md §8). Unset it to use ' +
        'NullSanctionsProvider, or implement an adapter class and wire it in here.',
    );
  }
  return new NullSanctionsProvider();
}

/**
 * Counterparty due diligence for a crypto wallet on a stablecoin/on-chain
 * settlement leg (FATF Travel Rule: `SettlementMethod = 'STABLECOIN'` in
 * `@neo-lloyds/domain`). Not wired into `SettlementService.initiate` yet —
 * that would need a destination-wallet field added to the settlement
 * input/persistence layer, a real schema change this repository has not
 * made — but the provider itself is real and callable today via
 * `POST /compliance/wallet-screening` (`apps/api/src/compliance/compliance.controller.ts`).
 */
export interface WalletScreeningResult {
  readonly providerId: string;
  readonly screened: boolean;
  readonly riskScore: number | null;
  readonly severity: string | null;
  readonly sanctionsHit: boolean;
  readonly screenedAt: string;
}

export interface WalletScreeningProvider {
  readonly providerId: string;
  screenWallet(input: { walletAddress: string; blockchain: string }): Promise<WalletScreeningResult>;
}

export class NullWalletScreeningProvider implements WalletScreeningProvider {
  readonly providerId = 'null-provider';

  async screenWallet(): Promise<WalletScreeningResult> {
    return {
      providerId: this.providerId,
      screened: false,
      riskScore: null,
      severity: null,
      sanctionsHit: false,
      screenedAt: new Date().toISOString(),
    };
  }
}

export function createWalletScreeningProvider(): WalletScreeningProvider {
  const didit = createDiditWalletScreeningProviderFromEnv();
  if (didit) return didit;

  if (process.env['WALLET_SCREENING_PROVIDER_API_KEY']) {
    throw new Error(
      'WALLET_SCREENING_PROVIDER_API_KEY is set, but no real WalletScreeningProvider adapter ' +
        'is implemented yet. Unset it to use NullWalletScreeningProvider, or implement an ' +
        'adapter class and wire it in here.',
    );
  }
  return new NullWalletScreeningProvider();
}

/**
 * Creates a hosted, redirect-based verification session (Didit's KYC
 * document/liveness flow today; bank-account-ownership verification once
 * that add-on is enabled on the connected Didit account — confirmed live
 * via didit_workflow_create that it is NOT enabled today, see
 * apps/api/src/compliance/didit.ts). This is a genuinely different shape
 * from KybProvider/SanctionsProvider: those are synchronous checks this
 * server can complete in one request/response, but a human has to
 * actually go photograph a document or connect their bank, so the only
 * thing a server can do synchronously is start the session and hand back
 * a URL. **Completing the loop — learning the outcome — needs a webhook
 * receiver, which does not exist anywhere in this codebase yet
 * (confirmed: no route grep-matches "webhook" outside
 * apps/api/src/settlement's doc comments).** That is real, separate work,
 * not implied by this interface's existence.
 */
export interface VerificationSession {
  readonly providerId: string;
  readonly sessionId: string;
  readonly url: string;
  readonly status: string;
}

export interface VerificationSessionProvider {
  readonly providerId: string;
  createSession(input: { workflowId: string; vendorData: string }): Promise<VerificationSession>;
}

export class NullVerificationSessionProvider implements VerificationSessionProvider {
  readonly providerId = 'null-provider';

  async createSession(): Promise<VerificationSession> {
    throw new Error(
      'No VerificationSessionProvider is configured -- there is no null/simulated hosted ' +
        'verification flow (unlike KybProvider/SanctionsProvider, a fake session URL would be ' +
        'actively misleading to send to a real person). Set DIDIT_API_KEY and ' +
        'DIDIT_SESSION_CREATE_URL to enable one.',
    );
  }
}

export function createVerificationSessionProvider(): VerificationSessionProvider {
  const didit = createDiditVerificationSessionProviderFromEnv();
  if (didit) return didit;
  return new NullVerificationSessionProvider();
}
