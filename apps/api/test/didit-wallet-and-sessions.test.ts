import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DiditWalletScreeningProvider,
  createDiditWalletScreeningProviderFromEnv,
  DiditVerificationSessionProvider,
  createDiditVerificationSessionProviderFromEnv,
} from '../src/compliance/didit.js';
import { NullVerificationSessionProvider, NullWalletScreeningProvider } from '../src/compliance/providers.js';

const SCREEN_URL = 'https://example.invalid/wallet/screen';
const SESSION_URL = 'https://example.invalid/session/create';

/**
 * Copied verbatim from a real didit_transaction_screen_wallet sandbox
 * call (blockchain ETH) made through the Didit MCP connector while
 * building this adapter.
 */
const REAL_WALLET_SCREEN_RESPONSE = {
  provider: 'merklescience',
  screening_type: 'WALLET_SCREENING',
  risk_score: 0,
  severity: 'UNKNOWN',
  status: 'SCREENED',
  summary: 'Sandbox demo screening result - no real AML provider was called.',
  wallet_address: '0x28C6c06298d514Db089934071355E5743bf21d60',
  blockchain: 'ETH',
  sanctions_hit: false,
  pep_counterparty: false,
  raw_response: { sandbox: true },
};

/** Copied verbatim from a real didit_session_create sandbox call. */
const REAL_SESSION_CREATE_RESPONSE = {
  session_id: 'e1c69898-61af-49eb-b0bb-40de6af44e65',
  session_number: 4,
  session_token: 'M2_jzVEhncH3',
  url: 'https://verify.didit.me/session/M2_jzVEhncH3',
  vendor_data: 'test-signatory-org-1',
  status: 'Not Started',
  workflow_id: '477652f9-44b7-4242-b9c4-76bb536d7be9',
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DiditWalletScreeningProvider', () => {
  it('maps the real sandbox response, including a false sanctions_hit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse(REAL_WALLET_SCREEN_RESPONSE)));
    const provider = new DiditWalletScreeningProvider('test-key', SCREEN_URL);
    const result = await provider.screenWallet({ walletAddress: '0x28C6c06298d514Db089934071355E5743bf21d60', blockchain: 'ETH' });

    expect(result).toMatchObject({ providerId: 'didit', screened: true, riskScore: 0, severity: 'UNKNOWN', sanctionsHit: false });
  });

  it('sends wallet_address and blockchain matching the verified request shape', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(REAL_WALLET_SCREEN_RESPONSE));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new DiditWalletScreeningProvider('test-key', SCREEN_URL);
    await provider.screenWallet({ walletAddress: '0xabc', blockchain: 'ETH' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ wallet_address: '0xabc', blockchain: 'ETH' });
  });

  it('throws on a non-OK response rather than silently reporting a clean screen', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({}, false, 403)));
    const provider = new DiditWalletScreeningProvider('bad-key', SCREEN_URL);
    await expect(provider.screenWallet({ walletAddress: '0xabc', blockchain: 'ETH' })).rejects.toThrow('403');
  });
});

describe('createDiditWalletScreeningProviderFromEnv', () => {
  it('returns undefined when DIDIT_API_KEY is unset', () => {
    expect(createDiditWalletScreeningProviderFromEnv({})).toBeUndefined();
  });

  it('throws if DIDIT_API_KEY is set without DIDIT_WALLET_SCREEN_URL', () => {
    expect(() => createDiditWalletScreeningProviderFromEnv({ DIDIT_API_KEY: 'sk_x' })).toThrow(/DIDIT_WALLET_SCREEN_URL/);
  });
});

describe('NullWalletScreeningProvider', () => {
  it('reports screened:false rather than a fabricated clean result', async () => {
    const result = await new NullWalletScreeningProvider().screenWallet();
    expect(result.screened).toBe(false);
    expect(result.riskScore).toBeNull();
  });
});

describe('DiditVerificationSessionProvider', () => {
  it('maps the real sandbox session-create response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse(REAL_SESSION_CREATE_RESPONSE)));
    const provider = new DiditVerificationSessionProvider('test-key', SESSION_URL);
    const session = await provider.createSession({
      workflowId: '477652f9-44b7-4242-b9c4-76bb536d7be9',
      vendorData: 'test-signatory-org-1',
    });

    expect(session).toEqual({
      providerId: 'didit',
      sessionId: 'e1c69898-61af-49eb-b0bb-40de6af44e65',
      url: 'https://verify.didit.me/session/M2_jzVEhncH3',
      status: 'Not Started',
    });
  });

  it('throws on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({}, false, 400)));
    const provider = new DiditVerificationSessionProvider('bad-key', SESSION_URL);
    await expect(provider.createSession({ workflowId: 'w', vendorData: 'v' })).rejects.toThrow('400');
  });
});

describe('createDiditVerificationSessionProviderFromEnv', () => {
  it('returns undefined when DIDIT_API_KEY is unset', () => {
    expect(createDiditVerificationSessionProviderFromEnv({})).toBeUndefined();
  });

  it('throws if DIDIT_API_KEY is set without DIDIT_SESSION_CREATE_URL', () => {
    expect(() => createDiditVerificationSessionProviderFromEnv({ DIDIT_API_KEY: 'sk_x' })).toThrow(/DIDIT_SESSION_CREATE_URL/);
  });
});

describe('NullVerificationSessionProvider', () => {
  it('throws rather than handing back a fake session URL a real person could be sent to', async () => {
    await expect(new NullVerificationSessionProvider().createSession()).rejects.toThrow(/No VerificationSessionProvider/);
  });
});
