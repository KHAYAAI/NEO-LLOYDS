import type { KybCheckResult, KybProvider, KybVerdict } from './providers.js';
import type { SanctionsHit, SanctionsProvider, SanctionsScreeningResult } from './providers.js';

/**
 * A real `KybProvider` adapter for Didit (didit.me), built against its own
 * MCP connector rather than guessed: two live sandbox calls were made
 * through `didit_verify_kyb_search` / `didit_verify_kyb_select` (GB,
 * company "Tesco") and their exact JSON response shapes — field names,
 * nesting, the `status`/`registry_status` vocabulary — are what
 * `DiditSearchResponse`/`DiditSelectResponse` below are typed against.
 * Country coverage was confirmed live too: `didit_workflow_get_kyb_registry_catalog`
 * returned GB/US as `validated: true` and ZA (Neo-Lloyds' default
 * jurisdiction, ADR-0004) as `validated: false` — available, but Didit's
 * own catalog flags South African registry data as not yet validated to
 * the same standard. Surface that if it ever matters to a caller; it is
 * not distinguished in `KybVerdict` today.
 *
 * What is NOT verified, and why it's configurable rather than hardcoded:
 * this class calls Didit's REST API directly (the Neo-Lloyds API server
 * has no access to the MCP connector that produced the sandbox responses
 * above -- MCP tools are only callable from this coding session, not from
 * deployed application code). `docs.didit.me`, `verification.didit.me`
 * and `apidocs.didit.me` were all unreachable from the sandbox that wrote
 * this file (network egress blocked or DNS failure), and no official
 * Didit *server-side* Node SDK exists on npm to read real endpoint paths
 * out of (only `@didit-protocol/sdk-web` and `-sdk-react-native`, both
 * client-side widget SDKs -- checked before writing this, not assumed).
 * `DIDIT_KYB_SEARCH_URL` and `DIDIT_KYB_SELECT_URL` therefore have no
 * default: get the exact endpoint paths from your Didit dashboard's API
 * reference and set them explicitly, the same reasoning
 * apps/admin-portal/README.md applied to `OIDC_ISSUER_URL` for WorkOS --
 * an unconfirmed guessed URL failing loudly is better than one that
 * silently 404s or, worse, hits the wrong endpoint.
 */

interface DiditKybCandidate {
  readonly kyb_response_id: string;
  readonly name: string;
  readonly registration_number: string | null;
  readonly status: string | null;
}

interface DiditSearchResponse {
  readonly kyb_registry: {
    readonly companies: readonly DiditKybCandidate[];
    readonly search_resolved: boolean;
  };
}

interface DiditSelectResponse {
  readonly kyb_registry: {
    readonly company_name: string;
    readonly registration_number: string | null;
    readonly country_code: string;
    /** Observed live: "Approved". Declined/other values inferred from
     * the same vocabulary didit_session_list's `status` documents
     * (Not Started, In Progress, In Review, Approved, Declined, ...) --
     * not itself confirmed against a declined KYB record. */
    readonly status: string | null;
    readonly registry_status: string | null;
    readonly fetch_status: string;
  };
}

function mapDiditStatus(status: string | null): KybVerdict {
  switch (status) {
    case 'Approved':
      return 'VERIFIED';
    case 'Declined':
      return 'REJECTED';
    default:
      // Includes null, "In Review", "Not Started", and anything this
      // adapter hasn't seen a real example of -- REQUIRES_REVIEW is the
      // only safe default for an unrecognised value, never VERIFIED.
      return 'REQUIRES_REVIEW';
  }
}

export class DiditKybProvider implements KybProvider {
  readonly providerId = 'didit';

  constructor(
    private readonly apiKey: string,
    private readonly searchUrl: string,
    private readonly selectUrl: string,
  ) {}

  async check(input: { organisationId: string; legalName: string; jurisdiction: string }): Promise<KybCheckResult> {
    const checkedAt = new Date().toISOString();

    const searchResponse = await fetch(this.searchUrl, {
      method: 'POST',
      headers: { 'x-api-key': this.apiKey, 'content-type': 'application/json' },
      // country_code and search_type match the live-verified request shape
      // (didit_verify_kyb_search); "contains" was confirmed to be a valid
      // search_type live -- "start_with", listed in the MCP tool's own
      // schema, was rejected by the real API with a 400 when tried first.
      body: JSON.stringify({ country_code: input.jurisdiction, name: input.legalName, search_type: 'contains' }),
    });
    if (!searchResponse.ok) {
      throw new Error(`Didit KYB search returned ${searchResponse.status}`);
    }
    const searchBody = (await searchResponse.json()) as DiditSearchResponse;
    const candidate = searchBody.kyb_registry.companies[0];
    if (!candidate) {
      return { providerId: this.providerId, verdict: 'REQUIRES_REVIEW', checkedAt };
    }

    const selectResponse = await fetch(this.selectUrl, {
      method: 'POST',
      headers: { 'x-api-key': this.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ kyb_response_id: candidate.kyb_response_id }),
    });
    if (!selectResponse.ok) {
      throw new Error(`Didit KYB select returned ${selectResponse.status}`);
    }
    const selectBody = (await selectResponse.json()) as DiditSelectResponse;
    const record = selectBody.kyb_registry;

    return {
      providerId: this.providerId,
      verdict: mapDiditStatus(record.status),
      reference: record.registration_number ?? undefined,
      checkedAt,
    };
  }
}

export function createDiditKybProviderFromEnv(env: NodeJS.ProcessEnv = process.env): DiditKybProvider | undefined {
  const apiKey = env['DIDIT_API_KEY'];
  if (!apiKey) return undefined;

  const searchUrl = env['DIDIT_KYB_SEARCH_URL'];
  const selectUrl = env['DIDIT_KYB_SELECT_URL'];
  if (!searchUrl || !selectUrl) {
    throw new Error(
      'DIDIT_API_KEY is set, but DIDIT_KYB_SEARCH_URL/DIDIT_KYB_SELECT_URL are not. ' +
        'Get the exact KYB registry search/select endpoint paths from your Didit dashboard\'s ' +
        'API reference (this repository could not reach docs.didit.me to confirm them) and set both.',
    );
  }
  return new DiditKybProvider(apiKey, searchUrl, selectUrl);
}

/**
 * A real `SanctionsProvider` adapter for Didit, using the same account
 * and API key as `DiditKybProvider` above -- Didit's AML screening
 * (sanctions/PEP lists, optionally adverse media) is entity-type-aware
 * (`person` | `company`), which is exactly the `SanctionsProvider.screen`
 * shape (an organisation's legal name).
 *
 * Verified live through `didit_verify_aml` against the sandbox app: a
 * screen for "Sandbox Holdings Ltd" (entity_type: company) and, to try
 * to provoke a real hit, "Vladimir Putin" (entity_type: person) both
 * returned `{ status: "Approved", total_hits: 0, hits: [], score: 0,
 * warnings: [] }` — DiditAmlResponse below is typed against that
 * confirmed shape. **What is NOT verified: the shape of a populated
 * `hits` array.** The sandbox mock appears to always return zero hits
 * regardless of input (same deterministic-mock behaviour observed for
 * KYB registry search, which always returned one fixed "Sandbox
 * Holdings Ltd" candidate) -- there was no `sandbox_scenario`-equivalent
 * flag on this tool to force a hit the way session creation has
 * `decline_aml_hit`. `mapDiditHit` below is written defensively against
 * several plausible field-name conventions rather than one confirmed
 * shape; confirm it against a real match (or Didit's dashboard) before
 * depending on `SanctionsHit.listName`/`matchedName` for anything
 * decision-critical.
 */

interface DiditAmlHit {
  readonly [key: string]: unknown;
}

interface DiditAmlResponse {
  readonly aml: {
    readonly status: string;
    readonly total_hits: number;
    readonly hits: readonly DiditAmlHit[];
    readonly score: number;
  };
}

function mapDiditHit(hit: DiditAmlHit): SanctionsHit {
  const listName = hit['list_name'] ?? hit['source'] ?? hit['list'] ?? hit['category'];
  const matchedName = hit['matched_name'] ?? hit['name'] ?? hit['full_name'];
  const score = hit['match_score'] ?? hit['score'] ?? hit['confidence'];
  return {
    listName: typeof listName === 'string' ? listName : 'unknown (unconfirmed Didit hit shape)',
    matchedName: typeof matchedName === 'string' ? matchedName : 'unknown (unconfirmed Didit hit shape)',
    score: typeof score === 'number' ? score : 0,
  };
}

export class DiditSanctionsProvider implements SanctionsProvider {
  readonly providerId = 'didit';

  constructor(
    private readonly apiKey: string,
    private readonly screenUrl: string,
  ) {}

  async screen(input: { organisationId: string; legalName: string }): Promise<SanctionsScreeningResult> {
    const response = await fetch(this.screenUrl, {
      method: 'POST',
      headers: { 'x-api-key': this.apiKey, 'content-type': 'application/json' },
      // entity_type: "company" and full_name match the live-verified
      // didit_verify_aml request shape.
      body: JSON.stringify({ full_name: input.legalName, entity_type: 'company', include_adverse_media: true }),
    });
    if (!response.ok) {
      throw new Error(`Didit AML screen returned ${response.status}`);
    }
    const body = (await response.json()) as DiditAmlResponse;

    return {
      providerId: this.providerId,
      screened: true,
      hits: body.aml.hits.map(mapDiditHit),
      screenedAt: new Date().toISOString(),
    };
  }
}

export function createDiditSanctionsProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): DiditSanctionsProvider | undefined {
  const apiKey = env['DIDIT_API_KEY'];
  if (!apiKey) return undefined;

  const screenUrl = env['DIDIT_AML_SCREEN_URL'];
  if (!screenUrl) {
    throw new Error(
      'DIDIT_API_KEY is set, but DIDIT_AML_SCREEN_URL is not. Get the exact AML screening ' +
        "endpoint path from your Didit dashboard's API reference (this repository could not " +
        'reach docs.didit.me to confirm it) and set it.',
    );
  }
  return new DiditSanctionsProvider(apiKey, screenUrl);
}
