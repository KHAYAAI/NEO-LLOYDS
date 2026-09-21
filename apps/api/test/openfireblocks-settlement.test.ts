import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OpenFireblocksSettlementProvider,
  createOpenFireblocksSettlementProviderFromEnv,
  type StablecoinTokenConfig,
} from '../src/settlement/openfireblocks.js';

/**
 * Request/response shapes match OpenFireblocks' own source, read directly
 * from this session's clone of github.com/KHAYAAI/openfireblocks --
 * SignRequestDto, TemporalService.start/status, and the Go
 * TransactionResult struct's own json tags -- not invented. Never run
 * against a real running instance from this session: `docker compose up`
 * needs a Docker daemon, unavailable in this sandbox. See
 * apps/api/src/settlement/openfireblocks.ts's own doc comment for exactly
 * what that does and doesn't mean.
 */
const BASE_URL = 'https://example.invalid';
const SEPOLIA_USDC: StablecoinTokenConfig = {
  currency: 'USDC',
  chainId: 11155111,
  tokenAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  decimals: 6,
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenFireblocksSettlementProvider', () => {
  it('encodes a real ERC-20 transfer(address,uint256) call and starts a durable settlement', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ workflowId: 'settlement-org-1-abc123' }, true, 202))
      .mockResolvedValueOnce(
        jsonResponse({
          workflowId: 'settlement-org-1-abc123',
          status: 'COMPLETED',
          result: {
            requestId: 'req-1',
            txHash: '0xdeadbeef',
            status: 'confirmed',
            blockNumber: 12345,
            reason: 'settled',
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenFireblocksSettlementProvider('ofb_key', BASE_URL, [SEPOLIA_USDC], 1, 10_000);
    const result = await provider.submit({
      transactionId: 'txn-1',
      method: 'STABLECOIN',
      amountMinor: 5_000_000, // 5 USDC at 6 decimals
      currency: 'USDC',
      destinationAccountId: '0x1234567890123456789012345678901234567890',
    });

    expect(result).toEqual({ providerRef: '0xdeadbeef', succeeded: true });

    const [startUrl, startInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(startUrl).toBe(`${BASE_URL}/settlements`);
    const headers = startInit.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer ofb_key');

    const body = JSON.parse(startInit.body as string);
    expect(body.chainId).toBe(11155111);
    expect(body.to).toBe(SEPOLIA_USDC.tokenAddress);
    expect(body.value).toBe('0');
    // 0xa9059cbb = transfer(address,uint256) selector, then the 20-byte
    // recipient left-padded to 32 bytes, then the amount as a 32-byte
    // big-endian value -- computed independently here (not copied from the
    // implementation) so this test can actually catch an encoding bug.
    const expectedTo = '1234567890123456789012345678901234567890'.padStart(64, '0');
    const expectedAmount = (5_000_000n).toString(16).padStart(64, '0');
    expect(body.data).toBe(`0xa9059cbb${expectedTo}${expectedAmount}`);
    expect(body.data).toHaveLength(2 + 8 + 64 + 64); // 0x + selector + address + amount

    const [statusUrl] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(statusUrl).toBe(`${BASE_URL}/settlements/settlement-org-1-abc123`);
  });

  it('maps result.status "failed" to a failed SettlementSubmissionResult with the workflow\'s own reason', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ workflowId: 'wf-2' }, true, 202))
      .mockResolvedValueOnce(
        jsonResponse({
          workflowId: 'wf-2',
          status: 'COMPLETED',
          result: {
            requestId: 'req-2',
            txHash: '',
            status: 'failed',
            blockNumber: 0,
            reason: 'broadcast ok but monitoring failed: timeout',
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenFireblocksSettlementProvider('ofb_key', BASE_URL, [SEPOLIA_USDC], 1, 10_000);
    const result = await provider.submit({
      transactionId: 'txn-2',
      method: 'STABLECOIN',
      amountMinor: 1_000_000,
      currency: 'USDC',
      destinationAccountId: '0x1234567890123456789012345678901234567890',
    });

    expect(result.succeeded).toBe(false);
    expect(result.failureReason).toBe('broadcast ok but monitoring failed: timeout');
  });

  it('reports an honest "not yet terminal" result rather than fabricating success when the poll window elapses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ workflowId: 'wf-3' }, true, 202))
      .mockResolvedValue(jsonResponse({ workflowId: 'wf-3', status: 'RUNNING' }));
    vi.stubGlobal('fetch', fetchMock);

    // A ~5ms timeout with a 1ms poll interval keeps this test fast while
    // still exercising the real "give up and report pending" path.
    const provider = new OpenFireblocksSettlementProvider('ofb_key', BASE_URL, [SEPOLIA_USDC], 1, 5);
    const result = await provider.submit({
      transactionId: 'txn-3',
      method: 'STABLECOIN',
      amountMinor: 1_000_000,
      currency: 'USDC',
      destinationAccountId: '0x1234567890123456789012345678901234567890',
    });

    expect(result.succeeded).toBe(false);
    expect(result.providerRef).toBe('wf-3');
    expect(result.failureReason).toContain('did not reach a terminal state');
  });

  it('refuses any method other than STABLECOIN without ever calling OpenFireblocks', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenFireblocksSettlementProvider('ofb_key', BASE_URL, [SEPOLIA_USDC]);
    const result = await provider.submit({
      transactionId: 'txn-4',
      method: 'BANK_TRANSFER',
      amountMinor: 1000,
      currency: 'USD',
      destinationAccountId: 'acct_x',
    });

    expect(result.succeeded).toBe(false);
    expect(result.failureReason).toContain('only moves STABLECOIN');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a destination that is not a valid 20-byte Ethereum address', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenFireblocksSettlementProvider('ofb_key', BASE_URL, [SEPOLIA_USDC]);
    const result = await provider.submit({
      transactionId: 'txn-5',
      method: 'STABLECOIN',
      amountMinor: 1000,
      currency: 'USDC',
      destinationAccountId: 'acct_not_an_eth_address',
    });

    expect(result.succeeded).toBe(false);
    expect(result.failureReason).toContain('0x-prefixed 20-byte');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a currency with no configured stablecoin token', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenFireblocksSettlementProvider('ofb_key', BASE_URL, [SEPOLIA_USDC]);
    const result = await provider.submit({
      transactionId: 'txn-6',
      method: 'STABLECOIN',
      amountMinor: 1000,
      currency: 'DAI',
      destinationAccountId: '0x1234567890123456789012345678901234567890',
    });

    expect(result.succeeded).toBe(false);
    expect(result.failureReason).toContain('No stablecoin token is configured for currency DAI');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports failure, without a thrown exception, when /settlements itself returns a non-OK status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({}, false, 401)));
    const provider = new OpenFireblocksSettlementProvider('bad_key', BASE_URL, [SEPOLIA_USDC]);
    const result = await provider.submit({
      transactionId: 'txn-7',
      method: 'STABLECOIN',
      amountMinor: 1000,
      currency: 'USDC',
      destinationAccountId: '0x1234567890123456789012345678901234567890',
    });

    expect(result.succeeded).toBe(false);
    expect(result.failureReason).toContain('401');
  });
});

describe('createOpenFireblocksSettlementProviderFromEnv', () => {
  it('returns undefined when OPENFIREBLOCKS_API_KEY is unset', () => {
    expect(createOpenFireblocksSettlementProviderFromEnv({})).toBeUndefined();
  });

  it('throws if OPENFIREBLOCKS_API_KEY is set without OPENFIREBLOCKS_BASE_URL', () => {
    expect(() =>
      createOpenFireblocksSettlementProviderFromEnv({ OPENFIREBLOCKS_API_KEY: 'k' }),
    ).toThrow(/OPENFIREBLOCKS_BASE_URL/);
  });

  it('throws if OPENFIREBLOCKS_API_KEY is set without OPENFIREBLOCKS_STABLECOIN_TOKENS', () => {
    expect(() =>
      createOpenFireblocksSettlementProviderFromEnv({
        OPENFIREBLOCKS_API_KEY: 'k',
        OPENFIREBLOCKS_BASE_URL: BASE_URL,
      }),
    ).toThrow(/OPENFIREBLOCKS_STABLECOIN_TOKENS/);
  });

  it('constructs a real provider once every variable is set', () => {
    const provider = createOpenFireblocksSettlementProviderFromEnv({
      OPENFIREBLOCKS_API_KEY: 'k',
      OPENFIREBLOCKS_BASE_URL: BASE_URL,
      OPENFIREBLOCKS_STABLECOIN_TOKENS: JSON.stringify([SEPOLIA_USDC]),
    });
    expect(provider).toBeInstanceOf(OpenFireblocksSettlementProvider);
    expect(provider?.providerId).toBe('openfireblocks');
  });
});
