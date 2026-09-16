import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiditSanctionsProvider, createDiditSanctionsProviderFromEnv } from '../src/compliance/didit.js';

/**
 * The zero-hit response below is copied verbatim from two real Didit
 * sandbox calls made through the Didit MCP connector while building this
 * adapter (didit_verify_aml, entity_type "company" against "Sandbox
 * Holdings Ltd", and entity_type "person" against "Vladimir Putin" to try
 * to provoke a real hit) -- both returned zero hits, which is why the hit
 * mapping below is tested only against a synthetic hit object with several
 * plausible field-name spellings, not a confirmed real one. See
 * apps/api/src/compliance/didit.ts for the full honesty note.
 */
const SCREEN_URL = 'https://example.invalid/aml/screen';

const REAL_ZERO_HIT_RESPONSE = {
  request_id: '5a5d99da-2f4c-49bf-80f0-3766eee70e3f',
  aml: { status: 'Approved', total_hits: 0, entity_type: 'company', hits: [], score: 0, screened_data: {}, warnings: [] },
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DiditSanctionsProvider', () => {
  it('maps the real zero-hit sandbox response to screened:true with no hits', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse(REAL_ZERO_HIT_RESPONSE)));
    const provider = new DiditSanctionsProvider('test-key', SCREEN_URL);
    const result = await provider.screen({ organisationId: 'org-1', legalName: 'Sandbox Holdings Ltd' });

    expect(result.providerId).toBe('didit');
    expect(result.screened).toBe(true);
    expect(result.hits).toEqual([]);
  });

  it('sends entity_type company and the legal name, matching the verified request shape', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(REAL_ZERO_HIT_RESPONSE));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new DiditSanctionsProvider('test-key', SCREEN_URL);
    await provider.screen({ organisationId: 'org-1', legalName: 'Sandbox Holdings Ltd' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      full_name: 'Sandbox Holdings Ltd',
      entity_type: 'company',
    });
  });

  it('maps a hit defensively across plausible field-name spellings, since no real hit was reproducible', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        jsonResponse({
          aml: {
            status: 'In Review',
            total_hits: 1,
            hits: [{ list_name: 'OFAC SDN', matched_name: 'Some Sanctioned Entity', match_score: 0.92 }],
            score: 92,
          },
        }),
      ),
    );
    const provider = new DiditSanctionsProvider('test-key', SCREEN_URL);
    const result = await provider.screen({ organisationId: 'org-1', legalName: 'Some Sanctioned Entity' });

    expect(result.hits).toEqual([{ listName: 'OFAC SDN', matchedName: 'Some Sanctioned Entity', score: 0.92 }]);
  });

  it('never crashes or drops a hit whose shape does not match any known field name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        jsonResponse({ aml: { status: 'In Review', total_hits: 1, hits: [{ totally_unknown_field: true }], score: 1 } }),
      ),
    );
    const provider = new DiditSanctionsProvider('test-key', SCREEN_URL);
    const result = await provider.screen({ organisationId: 'org-1', legalName: 'X' });

    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.listName).toContain('unconfirmed');
  });

  it('throws on a non-OK response rather than silently reporting a clean screen', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({}, false, 500)));
    const provider = new DiditSanctionsProvider('bad-key', SCREEN_URL);
    await expect(provider.screen({ organisationId: 'org-1', legalName: 'X' })).rejects.toThrow('500');
  });
});

describe('createDiditSanctionsProviderFromEnv', () => {
  it('returns undefined when DIDIT_API_KEY is unset', () => {
    expect(createDiditSanctionsProviderFromEnv({})).toBeUndefined();
  });

  it('throws if DIDIT_API_KEY is set without DIDIT_AML_SCREEN_URL', () => {
    expect(() => createDiditSanctionsProviderFromEnv({ DIDIT_API_KEY: 'sk_x' })).toThrow(/DIDIT_AML_SCREEN_URL/);
  });

  it('constructs a real provider once both env vars are set', () => {
    const provider = createDiditSanctionsProviderFromEnv({
      DIDIT_API_KEY: 'sk_x',
      DIDIT_AML_SCREEN_URL: SCREEN_URL,
    });
    expect(provider).toBeInstanceOf(DiditSanctionsProvider);
  });
});
