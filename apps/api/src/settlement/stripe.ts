import type { SettlementMethod } from '@neo-lloyds/domain';
import type { SettlementProvider, SettlementSubmissionResult } from './providers.js';

/**
 * A real `SettlementProvider` adapter for Stripe Connect Transfers.
 *
 * Unlike the Didit adapters (apps/api/src/compliance/didit.ts), the REST
 * contract here is fully confirmed, not left as an operator-supplied
 * placeholder: `api.stripe.com` was unreachable from this sandbox
 * (network egress blocked), so ground truth came from reading the
 * *official* `stripe` npm package's own installed source directly —
 * `node_modules/stripe/cjs/stripe.core.js` (`DEFAULT_HOST =
 * 'api.stripe.com'`), `resources/Transfers.js`
 * (`POST /v1/transfers`), and `RequestSender.js` (auth is
 * `Authorization: Bearer <apiKey>`; the request body for a v1 endpoint
 * is `application/x-www-form-urlencoded`, NOT JSON — confirmed from the
 * SDK's own content-type branch, not assumed from REST convention; and
 * every request carries an `Idempotency-Key` header). This is the
 * project's official first-party SDK, the same tier of ground truth
 * `@workos-inc/node` gave the OIDC JWKS URL earlier — not a guess and not
 * a third-party reverse-engineering the way one Didit signal was.
 *
 * Scope, stated plainly:
 * - Handles `BANK_TRANSFER` and `DIGITAL_MONEY` via a Stripe Connect
 *   Transfer to a pre-existing connected account. `STABLECOIN` is
 *   refused with a clear error — Stripe does not move crypto directly,
 *   and pretending otherwise would be worse than an honest failure.
 * - Requires `destinationAccountId` (a Stripe Connect account id) on the
 *   transaction. Neo-Lloyds does not yet store a per-organisation Stripe
 *   Connect account anywhere — `SettlementService.initiate` accepts an
 *   optional `destinationAccountId` (threaded through from
 *   `POST /settlement/transactions`), but nothing populates one
 *   automatically today. Onboarding a capital provider onto Stripe
 *   Connect (their own KYC with Stripe, account linking) is real,
 *   separate work this adapter does not attempt.
 * - This was never run against a real Stripe account (sandbox or live)
 *   from this session — `api.stripe.com` was unreachable. The request/
 *   response shapes are typed against Stripe's own published TypeScript
 *   definitions (`node_modules/stripe/.../Transfers.d.ts`), which is
 *   strong evidence but not a substitute for one real call.
 */

interface StripeTransfer {
  readonly id: string;
  readonly object: 'transfer';
  readonly amount: number;
  readonly currency: string;
  readonly destination: string;
}

interface StripeError {
  readonly error: {
    readonly message: string;
    readonly type: string;
    readonly code?: string;
  };
}

const UNSUPPORTED_BY_STRIPE: readonly SettlementMethod[] = ['STABLECOIN'];

export class StripeSettlementProvider implements SettlementProvider {
  readonly providerId = 'stripe';

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = 'https://api.stripe.com',
  ) {}

  async submit(input: {
    transactionId: string;
    method: SettlementMethod;
    amountMinor: number;
    currency: string;
    destinationAccountId?: string;
  }): Promise<SettlementSubmissionResult> {
    if (UNSUPPORTED_BY_STRIPE.includes(input.method)) {
      return {
        providerRef: `stripe-unsupported-${input.transactionId}`,
        succeeded: false,
        failureReason: `Stripe does not move ${input.method} directly -- no stablecoin/on-chain settlement rail is configured.`,
      };
    }

    if (!input.destinationAccountId) {
      return {
        providerRef: `stripe-no-destination-${input.transactionId}`,
        succeeded: false,
        failureReason:
          'No destinationAccountId (Stripe Connect account id) was set on this transaction -- ' +
          'Neo-Lloyds does not yet store one per organisation. Pass destinationAccountId to ' +
          'POST /settlement/transactions once the recipient has a linked Stripe Connect account.',
      };
    }

    const body = new URLSearchParams({
      currency: input.currency.toLowerCase(),
      destination: input.destinationAccountId,
      amount: String(input.amountMinor),
      'metadata[neo_lloyds_transaction_id]': input.transactionId,
    });

    const response = await fetch(`${this.baseUrl}/v1/transfers`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        // Idempotency-Key is a real Stripe convention (confirmed in the
        // SDK's own RequestSender.js) -- the transaction id is a natural,
        // retry-safe choice: resubmitting the same transaction can never
        // create a duplicate transfer at Stripe.
        'Idempotency-Key': input.transactionId,
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorBody = (await response.json()) as StripeError;
      return {
        providerRef: `stripe-failed-${input.transactionId}`,
        succeeded: false,
        failureReason: errorBody.error?.message ?? `Stripe returned ${response.status}`,
      };
    }

    const transfer = (await response.json()) as StripeTransfer;
    return { providerRef: transfer.id, succeeded: true };
  }
}

export function createStripeSettlementProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): StripeSettlementProvider | undefined {
  const apiKey = env['STRIPE_API_KEY'];
  if (!apiKey) return undefined;
  return new StripeSettlementProvider(apiKey, env['STRIPE_API_BASE_URL'] ?? 'https://api.stripe.com');
}
