import { afterEach, describe, expect, it, vi } from 'vitest';
import { StripeSettlementProvider, createStripeSettlementProviderFromEnv } from '../src/settlement/stripe.js';

/**
 * Request/response shapes match Stripe's own published TypeScript
 * definitions for the Transfers resource (node_modules/stripe's own
 * Transfers.d.ts, read directly while building this adapter) -- not
 * invented. api.stripe.com itself was unreachable from this sandbox
 * (network egress blocked), so these fixtures were never confirmed
 * against a real Stripe sandbox call the way the Didit ones were; see
 * apps/api/src/settlement/stripe.ts's own doc comment for exactly what
 * that does and doesn't mean.
 */
const TRANSFERS_URL = 'https://example.invalid';

const REAL_SHAPE_TRANSFER: unknown = {
  id: 'tr_1QxSandboxExample',
  object: 'transfer',
  amount: 15000,
  amount_reversed: 0,
  currency: 'usd',
  destination: 'acct_1QxConnectedExample',
  created: 1732000000,
  livemode: false,
  reversed: false,
};

const REAL_SHAPE_ERROR = {
  error: {
    message: 'Your card was declined.',
    type: 'card_error',
    code: 'card_declined',
  },
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('StripeSettlementProvider', () => {
  it('submits a real Transfer request (form-encoded, Bearer auth, Idempotency-Key) and maps a successful response', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(REAL_SHAPE_TRANSFER));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new StripeSettlementProvider('sk_test_x', TRANSFERS_URL);
    const result = await provider.submit({
      transactionId: 'txn-1',
      method: 'BANK_TRANSFER',
      amountMinor: 15000,
      currency: 'USD',
      destinationAccountId: 'acct_1QxConnectedExample',
    });

    expect(result).toEqual({ providerRef: 'tr_1QxSandboxExample', succeeded: true });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${TRANSFERS_URL}/v1/transfers`);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk_test_x');
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(headers['Idempotency-Key']).toBe('txn-1');

    const params = new URLSearchParams(init.body as string);
    expect(params.get('currency')).toBe('usd');
    expect(params.get('destination')).toBe('acct_1QxConnectedExample');
    expect(params.get('amount')).toBe('15000');
  });

  it('refuses STABLECOIN without ever calling Stripe -- it does not move crypto', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const provider = new StripeSettlementProvider('sk_test_x', TRANSFERS_URL);
    const result = await provider.submit({
      transactionId: 'txn-2',
      method: 'STABLECOIN',
      amountMinor: 1000,
      currency: 'USD',
      destinationAccountId: 'acct_x',
    });

    expect(result.succeeded).toBe(false);
    expect(result.failureReason).toContain('does not move');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails clearly, without calling Stripe, when no destinationAccountId is set', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const provider = new StripeSettlementProvider('sk_test_x', TRANSFERS_URL);
    const result = await provider.submit({
      transactionId: 'txn-3',
      method: 'BANK_TRANSFER',
      amountMinor: 1000,
      currency: 'USD',
    });

    expect(result.succeeded).toBe(false);
    expect(result.failureReason).toContain('destinationAccountId');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a real-shaped Stripe error response to a failed result, not a thrown exception', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse(REAL_SHAPE_ERROR, false, 402)));
    const provider = new StripeSettlementProvider('sk_test_x', TRANSFERS_URL);
    const result = await provider.submit({
      transactionId: 'txn-4',
      method: 'DIGITAL_MONEY',
      amountMinor: 1000,
      currency: 'USD',
      destinationAccountId: 'acct_x',
    });

    expect(result.succeeded).toBe(false);
    expect(result.failureReason).toBe('Your card was declined.');
  });
});

describe('createStripeSettlementProviderFromEnv', () => {
  it('returns undefined when STRIPE_API_KEY is unset -- createSettlementProvider falls back to Null', () => {
    expect(createStripeSettlementProviderFromEnv({})).toBeUndefined();
  });

  it('constructs a real provider once STRIPE_API_KEY is set', () => {
    const provider = createStripeSettlementProviderFromEnv({ STRIPE_API_KEY: 'sk_test_x' });
    expect(provider).toBeInstanceOf(StripeSettlementProvider);
    expect(provider?.providerId).toBe('stripe');
  });
});
