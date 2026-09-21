import { describe, expect, it } from 'vitest';
import {
  CompositeSettlementProvider,
  createSettlementProvider,
  NullSettlementProvider,
  type SettlementProvider,
  type SettlementSubmissionResult,
} from '../src/settlement/providers.js';

class FakeProvider implements SettlementProvider {
  readonly calls: unknown[] = [];
  constructor(
    readonly providerId: string,
    private readonly result: SettlementSubmissionResult,
  ) {}
  async submit(input: unknown): Promise<SettlementSubmissionResult> {
    this.calls.push(input);
    return this.result;
  }
}

describe('CompositeSettlementProvider', () => {
  it('routes STABLECOIN to the stablecoin provider and nothing else', async () => {
    const stablecoin = new FakeProvider('fake-stablecoin', { providerRef: 'sc-1', succeeded: true });
    const fallback = new FakeProvider('fake-fallback', { providerRef: 'fb-1', succeeded: true });
    const composite = new CompositeSettlementProvider(stablecoin, fallback);

    const result = await composite.submit({
      transactionId: 'txn-1',
      method: 'STABLECOIN',
      amountMinor: 100,
      currency: 'USDC',
    });

    expect(result.providerRef).toBe('sc-1');
    expect(stablecoin.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(0);
  });

  it('routes every non-STABLECOIN method to the fallback provider', async () => {
    const stablecoin = new FakeProvider('fake-stablecoin', { providerRef: 'sc-1', succeeded: true });
    const fallback = new FakeProvider('fake-fallback', { providerRef: 'fb-1', succeeded: true });
    const composite = new CompositeSettlementProvider(stablecoin, fallback);

    const result = await composite.submit({
      transactionId: 'txn-2',
      method: 'BANK_TRANSFER',
      amountMinor: 100,
      currency: 'USD',
    });

    expect(result.providerRef).toBe('fb-1');
    expect(fallback.calls).toHaveLength(1);
    expect(stablecoin.calls).toHaveLength(0);
  });

  it('falls back for STABLECOIN when no stablecoin provider is configured, rather than throwing', async () => {
    const fallback = new FakeProvider('fake-fallback', { providerRef: 'fb-1', succeeded: true });
    const composite = new CompositeSettlementProvider(undefined, fallback);

    const result = await composite.submit({
      transactionId: 'txn-3',
      method: 'STABLECOIN',
      amountMinor: 100,
      currency: 'USDC',
    });

    expect(result.providerRef).toBe('fb-1');
  });
});

describe('createSettlementProvider', () => {
  it('returns the bare Null provider when nothing is configured', () => {
    const provider = createSettlementProvider();
    expect(provider).toBeInstanceOf(NullSettlementProvider);
  });

  it('wraps in a CompositeSettlementProvider once OpenFireblocks env vars are set, keeping STABLECOIN routable without breaking the existing Null/Stripe fallback', () => {
    const originalEnv = { ...process.env };
    try {
      process.env['OPENFIREBLOCKS_API_KEY'] = 'k';
      process.env['OPENFIREBLOCKS_BASE_URL'] = 'https://example.invalid';
      process.env['OPENFIREBLOCKS_STABLECOIN_TOKENS'] = JSON.stringify([
        { currency: 'USDC', chainId: 11155111, tokenAddress: '0x1234567890123456789012345678901234567890', decimals: 6 },
      ]);

      const provider = createSettlementProvider();
      expect(provider).toBeInstanceOf(CompositeSettlementProvider);
      expect(provider.providerId).toBe('composite(openfireblocks+null-provider)');
    } finally {
      process.env = originalEnv;
    }
  });
});
