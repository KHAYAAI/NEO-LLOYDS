import type { SettlementMethod } from '@neo-lloyds/domain';
import { createStripeSettlementProviderFromEnv } from './stripe.js';
import { createOpenFireblocksSettlementProviderFromEnv } from './openfireblocks.js';

/**
 * The `SettlementProvider` port: what actually moves money for a given
 * settlement method. `NullSettlementProvider` records everything precisely
 * and moves nothing — the honest default when no real rail is configured.
 * `StripeSettlementProvider` (apps/api/src/settlement/stripe.ts) is the
 * first real implementation: Stripe Connect Transfers for BANK_TRANSFER/
 * DIGITAL_MONEY. Same pattern as the AI analyst provider
 * (`apps/api/src/analyst/providers.ts`): degrade to a clearly labelled
 * no-op rather than fabricate a successful transfer.
 */
export interface SettlementSubmissionResult {
  readonly providerRef: string;
  readonly succeeded: boolean;
  readonly failureReason?: string;
}

export interface SettlementProvider {
  readonly providerId: string;
  submit(input: {
    transactionId: string;
    method: SettlementMethod;
    amountMinor: number;
    currency: string;
    /** e.g. a Stripe Connect account id. Absent for the Null provider or when no destination was configured on the transaction. */
    destinationAccountId?: string;
  }): Promise<SettlementSubmissionResult>;
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

/**
 * Routes by settlement method rather than picking one provider for
 * everything: STABLECOIN goes to OpenFireblocks when configured (the only
 * provider in this codebase that can move it at all -- Stripe refuses it
 * outright), every other method goes to the fallback (Stripe, or Null).
 * `SettlementService` never sees this split -- it calls one
 * `SettlementProvider`, same as before this router existed.
 */
export class CompositeSettlementProvider implements SettlementProvider {
  readonly providerId: string;

  constructor(
    private readonly stablecoinProvider: SettlementProvider | undefined,
    private readonly fallbackProvider: SettlementProvider,
  ) {
    this.providerId = `composite(${stablecoinProvider?.providerId ?? 'none'}+${fallbackProvider.providerId})`;
  }

  async submit(input: {
    transactionId: string;
    method: SettlementMethod;
    amountMinor: number;
    currency: string;
    destinationAccountId?: string;
  }) {
    if (input.method === 'STABLECOIN' && this.stablecoinProvider) {
      return this.stablecoinProvider.submit(input);
    }
    return this.fallbackProvider.submit(input);
  }
}

/**
 * Wiring order: a real Stripe adapter first when `STRIPE_API_KEY` is set
 * (apps/api/src/settlement/stripe.ts — built against Stripe's own
 * installed Node SDK source as ground truth, the same technique used for
 * WorkOS's JWKS URL earlier in this project), then the honest Null
 * fallback for everything Stripe or nothing else handles. Separately, a
 * real OpenFireblocks adapter (apps/api/src/settlement/openfireblocks.ts —
 * built against OpenFireblocks' own source, self-hosted, not a third-party
 * vendor) is layered on top for STABLECOIN specifically, since neither
 * Stripe nor the Null provider can move it for real. No "key set but no
 * adapter" throw is needed here the way compliance/providers.ts has one —
 * each real adapter's own factory already validates its own configuration.
 */
export function createSettlementProvider(): SettlementProvider {
  const stripe = createStripeSettlementProviderFromEnv();
  const fallback = stripe ?? new NullSettlementProvider();

  const openFireblocks = createOpenFireblocksSettlementProviderFromEnv();
  if (openFireblocks) return new CompositeSettlementProvider(openFireblocks, fallback);

  return fallback;
}
