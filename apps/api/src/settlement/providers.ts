import type { SettlementMethod } from '@neo-lloyds/domain';

/**
 * The `SettlementProvider` port: what actually moves money for a given
 * settlement method. This phase ships exactly one honest implementation —
 * `NullSettlementProvider`, which records everything precisely and moves
 * nothing — because no real bank, digital-money, or stablecoin integration
 * exists yet (docs/reports/phase-10.md). Same pattern as the AI analyst
 * provider (`apps/api/src/analyst/providers.ts`): degrade to a clearly
 * labelled no-op rather than fabricate a successful transfer.
 */
export interface SettlementSubmissionResult {
  readonly providerRef: string;
  readonly succeeded: boolean;
  readonly failureReason?: string;
}

export interface SettlementProvider {
  readonly providerId: string;
  submit(input: { transactionId: string; method: SettlementMethod; amountMinor: number; currency: string }): Promise<SettlementSubmissionResult>;
}

/**
 * Simulates instant, always-successful settlement and records a clearly
 * fake reference (`sim-...`) so nothing downstream could mistake this for a
 * real provider confirmation. This is what makes Phase 10 usable end to end
 * with zero external dependencies — exactly the same role
 * `NullAnalystProvider` plays for Phase 2.
 */
export class NullSettlementProvider implements SettlementProvider {
  readonly providerId = 'null-provider';

  async submit(input: {
    transactionId: string;
    method: SettlementMethod;
    amountMinor: number;
    currency: string;
  }): Promise<SettlementSubmissionResult> {
    return {
      providerRef: `sim-${input.method.toLowerCase()}-${input.transactionId}`,
      succeeded: true,
    };
  }
}

export function createSettlementProvider(): SettlementProvider {
  // No real bank/digital-money/stablecoin integration is configured for
  // this prototype (docs/security-model.md's honesty pattern applies here
  // exactly as it does to SSO §10): a fake success from a fake bank
  // connection would be worse than an explicit simulated one.
  return new NullSettlementProvider();
}
