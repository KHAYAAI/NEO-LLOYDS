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
 * If a KYB_PROVIDER_API_KEY is set but no real adapter class exists yet,
 * fail loudly rather than silently behave like the null provider — an
 * operator who set a real key is trying to turn real screening on, and a
 * quiet no-op would be a worse failure mode than a startup error (the same
 * "no opinion beats a made-up opinion" reasoning ADR-0006 applies to the AI
 * analyst applies here).
 */
export function createKybProvider(): KybProvider {
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
  if (process.env['SANCTIONS_PROVIDER_API_KEY']) {
    throw new Error(
      'SANCTIONS_PROVIDER_API_KEY is set, but no real SanctionsProvider adapter is ' +
        'implemented yet (docs/security-model.md §8). Unset it to use ' +
        'NullSanctionsProvider, or implement an adapter class and wire it in here.',
    );
  }
  return new NullSanctionsProvider();
}
