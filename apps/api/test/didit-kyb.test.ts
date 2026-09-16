import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiditKybProvider, createDiditKybProviderFromEnv } from '../src/compliance/didit.js';

/**
 * Request/response bodies below are copied verbatim from two real Didit
 * sandbox calls made through the Didit MCP connector while building this
 * adapter (didit_verify_kyb_search then didit_verify_kyb_select, country
 * GB, search "Tesco") -- not invented. See apps/api/src/compliance/didit.ts
 * for what is and isn't verified about the adapter overall (the REST
 * endpoint paths themselves are not -- docs.didit.me was unreachable from
 * the sandbox that wrote this).
 */
const SEARCH_URL = 'https://example.invalid/kyb/search';
const SELECT_URL = 'https://example.invalid/kyb/select';

const REAL_SEARCH_RESPONSE = {
  request_id: '276a95f3-1856-49dc-b693-0d4034775071',
  kyb_registry: {
    companies: [
      {
        kyb_response_id: 'sandbox-kyb-response-276a95f3-1856-49dc-b693-0d4034775071',
        name: 'Tesco',
        registration_number: 'SANDBOX-0001',
        status: 'active',
        type: 'Private Limited Company',
        risk_level: null,
        fetch_status: 'pending',
      },
    ],
    pagination: { total: 1, page: 1, per_page: 25 },
    search_status: 'resolved',
    search_resolved: true,
  },
};

function realSelectResponse(status: string | null) {
  return {
    request_id: '9db4d9ab-6b17-4f11-99a3-e231577ea7ba',
    registry_tier_requested: 'basic',
    registry_tier_delivered: 'basic',
    kyb_registry: {
      uuid: '6ce6abba-2d38-48c9-9163-0845adcdcfce',
      node_id: 'feature_kyb_registry',
      status,
      registry_status: 'active',
      data_resolved: true,
      company_name: 'Sandbox Holdings Ltd',
      registration_number: 'SANDBOX-0001',
      country_code: 'GB',
      fetch_status: 'resolved',
    },
  };
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DiditKybProvider', () => {
  it('maps a real Approved sandbox response to VERIFIED', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(REAL_SEARCH_RESPONSE))
      .mockResolvedValueOnce(jsonResponse(realSelectResponse('Approved')));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new DiditKybProvider('test-key', SEARCH_URL, SELECT_URL);
    const result = await provider.check({ organisationId: 'org-1', legalName: 'Tesco', jurisdiction: 'GB' });

    expect(result).toMatchObject({ providerId: 'didit', verdict: 'VERIFIED', reference: 'SANDBOX-0001' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, searchInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(searchInit.body as string)).toEqual({
      country_code: 'GB',
      name: 'Tesco',
      search_type: 'contains',
    });
  });

  it('maps a Declined status to REJECTED', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(REAL_SEARCH_RESPONSE))
        .mockResolvedValueOnce(jsonResponse(realSelectResponse('Declined'))),
    );
    const provider = new DiditKybProvider('test-key', SEARCH_URL, SELECT_URL);
    const result = await provider.check({ organisationId: 'org-1', legalName: 'Tesco', jurisdiction: 'GB' });
    expect(result.verdict).toBe('REJECTED');
  });

  it('never maps an unrecognised or null status to VERIFIED', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(REAL_SEARCH_RESPONSE))
        .mockResolvedValueOnce(jsonResponse(realSelectResponse(null))),
    );
    const provider = new DiditKybProvider('test-key', SEARCH_URL, SELECT_URL);
    const result = await provider.check({ organisationId: 'org-1', legalName: 'Tesco', jurisdiction: 'GB' });
    expect(result.verdict).toBe('REQUIRES_REVIEW');
  });

  it('returns REQUIRES_REVIEW, not a crash, when the registry search finds nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        jsonResponse({ kyb_registry: { companies: [], search_resolved: true } }),
      ),
    );
    const provider = new DiditKybProvider('test-key', SEARCH_URL, SELECT_URL);
    const result = await provider.check({ organisationId: 'org-1', legalName: 'Nobody Ltd', jurisdiction: 'GB' });
    expect(result.verdict).toBe('REQUIRES_REVIEW');
    expect(result.reference).toBeUndefined();
  });

  it('throws on a non-OK search response rather than silently treating it as no match', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({}, false, 401)));
    const provider = new DiditKybProvider('bad-key', SEARCH_URL, SELECT_URL);
    await expect(
      provider.check({ organisationId: 'org-1', legalName: 'Tesco', jurisdiction: 'GB' }),
    ).rejects.toThrow('401');
  });
});

describe('createDiditKybProviderFromEnv', () => {
  it('returns undefined when DIDIT_API_KEY is unset', () => {
    expect(createDiditKybProviderFromEnv({})).toBeUndefined();
  });

  it('throws if DIDIT_API_KEY is set without the endpoint URLs, rather than silently no-op', () => {
    expect(() => createDiditKybProviderFromEnv({ DIDIT_API_KEY: 'sk_x' })).toThrow(/DIDIT_KYB_SEARCH_URL/);
  });

  it('constructs a real provider once all three env vars are set', () => {
    const provider = createDiditKybProviderFromEnv({
      DIDIT_API_KEY: 'sk_x',
      DIDIT_KYB_SEARCH_URL: SEARCH_URL,
      DIDIT_KYB_SELECT_URL: SELECT_URL,
    });
    expect(provider).toBeInstanceOf(DiditKybProvider);
    expect(provider?.providerId).toBe('didit');
  });
});
