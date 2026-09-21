import type { SettlementMethod } from '@neo-lloyds/domain';
import type { SettlementProvider, SettlementSubmissionResult } from './providers.js';

/**
 * A real `SettlementProvider` adapter for OpenFireblocks
 * (github.com/KHAYAAI/openfireblocks) -- a sovereign, self-hosted
 * threshold-MPC signing/settlement platform, not a third-party vendor.
 * Handles `STABLECOIN` only, encoding an ERC-20 `transfer(address,uint256)`
 * call and submitting it through OpenFireblocks' own durable settlement
 * workflow (policy -> sign -> broadcast -> monitor, with a human-approval
 * gate for high-value transactions).
 *
 * Ground truth for every shape below came from reading OpenFireblocks' own
 * source directly (cloned into this session), the same tier of evidence
 * the Stripe adapter used its installed SDK source for -- not guessed, not
 * reverse-engineered from a public API doc:
 *   - `POST /settlements` request body: `services/api-gateway/src/sign/dto/sign-request.dto.ts`
 *     (`SignRequestDto` -- chainId, to, data, value, gasLimit, gasPrice,
 *     nonce, country), reused verbatim by `SettlementsController.start`.
 *   - `POST /settlements` response: `TemporalService.start` returns
 *     `{ workflowId: string }` with HTTP 202.
 *   - `GET /settlements/:workflowId` response:
 *     `{ workflowId, status, result? }` where `status` is the *Temporal*
 *     workflow status name (`RUNNING`, `COMPLETED`, `FAILED`, ...), and
 *     `result` (present only once `status === 'COMPLETED'`) is the
 *     workflow's own `TransactionResult`
 *     (`services/temporal-worker/workflows/types.go`): `{ requestId,
 *     txHash, status: 'denied'|'signed'|'broadcasted'|'confirmed'|'failed',
 *     blockNumber, reason }` -- note the *inner* `result.status` is the
 *     one that actually answers "did this settle", not the outer
 *     Temporal `status`.
 *   - Auth: `Authorization: Bearer <apiKey>` or `X-API-Key: <apiKey>`
 *     (`services/api-gateway/src/auth/api-key.guard.ts`).
 *
 * What is NOT verified: this was never run against a live OpenFireblocks
 * instance from this session -- `docker compose up` requires a Docker
 * daemon, which is unavailable in this sandbox (`docker ps` fails with
 * "no such file or directory" on the socket). The shapes above are read
 * from OpenFireblocks' own source, not observed from a real response.
 *
 * A real architectural simplification, stated plainly rather than hidden:
 * `SettlementService.initiate` (apps/api/src/settlement/settlement.service.ts)
 * is a synchronous call chain -- it awaits `provider.submit()` once and
 * expects a final result. OpenFireblocks' `/settlements` endpoint is
 * asynchronous by design (a durable Temporal workflow that can wait up to
 * an hour for human approval on a high-value transaction). This adapter
 * bridges that gap by polling `GET /settlements/:workflowId` for up to
 * `pollTimeoutMs` (default 60s -- appropriate for the common,
 * auto-approved, low-value path) and returning `succeeded: false` with an
 * honest "still pending" reason if the workflow hasn't reached a terminal
 * state by then, rather than blocking the request for up to an hour or
 * fabricating a result it doesn't have yet. A correct long-term
 * integration would have `SettlementService` leave the transaction
 * `SUBMITTED` and confirm it later via a webhook or a separate poll --
 * that is real, separate work this adapter does not attempt (mirrors the
 * exact gap `SettlementService`'s own doc comment already names for "a
 * real, asynchronous provider").
 */

interface OpenFireblocksStartResponse {
  readonly workflowId: string;
}

interface OpenFireblocksTransactionResult {
  readonly requestId: string;
  readonly txHash: string;
  readonly status: 'denied' | 'signed' | 'broadcasted' | 'confirmed' | 'failed';
  readonly blockNumber: number;
  readonly reason: string;
}

interface OpenFireblocksStatusResponse {
  readonly workflowId: string;
  /** The outer Temporal workflow status (RUNNING/COMPLETED/FAILED/...), not the settlement outcome -- see result.status for that. */
  readonly status: string;
  readonly result?: OpenFireblocksTransactionResult;
}

/** A stablecoin token this adapter knows how to move -- currency code is Neo-Lloyds' own SettlementTransaction.currency, not a token symbol. */
export interface StablecoinTokenConfig {
  readonly currency: string;
  readonly chainId: number;
  readonly tokenAddress: string;
  /** The token's own on-chain decimals (e.g. 6 for USDC, not 18) -- amountMinor is reinterpreted as this token's smallest unit, documented explicitly because it is NOT the same "minor unit" convention (e.g. cents) the rest of this codebase's Money type uses for fiat currencies. */
  readonly decimals: number;
}

const ERC20_TRANSFER_SELECTOR = '0xa9059cbb'; // keccak256("transfer(address,uint256)")[0:4] -- a fixed, unambiguous ERC-20 constant, not something to verify per-call.
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/; // matches OpenFireblocks' own SignRequestDto validation exactly.
const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_POLL_TIMEOUT_MS = 60_000;
const DEFAULT_GAS_LIMIT = 65_000; // a plain ERC-20 transfer typically costs ~50-65k gas; real gas estimation would call OpenFireblocks' own GET /prepare instead of a fixed value.

function encodeErc20Transfer(to: string, amountMinor: number): string {
  const toParam = to.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const amountParam = BigInt(amountMinor).toString(16).padStart(64, '0');
  return `${ERC20_TRANSFER_SELECTOR}${toParam}${amountParam}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class OpenFireblocksSettlementProvider implements SettlementProvider {
  readonly providerId = 'openfireblocks';

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly tokens: readonly StablecoinTokenConfig[],
    private readonly pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
    private readonly pollTimeoutMs: number = DEFAULT_POLL_TIMEOUT_MS,
  ) {}

  async submit(input: {
    transactionId: string;
    method: SettlementMethod;
    amountMinor: number;
    currency: string;
    /** The recipient's Ethereum address -- reuses the existing destinationAccountId field (a Stripe Connect account id for BANK_TRANSFER/DIGITAL_MONEY); for STABLECOIN it must be a 0x-prefixed 20-byte address instead. */
    destinationAccountId?: string;
  }): Promise<SettlementSubmissionResult> {
    if (input.method !== 'STABLECOIN') {
      return {
        providerRef: `openfireblocks-unsupported-${input.transactionId}`,
        succeeded: false,
        failureReason: `OpenFireblocksSettlementProvider only moves STABLECOIN -- ${input.method} should route to a different provider.`,
      };
    }

    if (!input.destinationAccountId || !ADDRESS_PATTERN.test(input.destinationAccountId)) {
      return {
        providerRef: `openfireblocks-invalid-destination-${input.transactionId}`,
        succeeded: false,
        failureReason:
          'destinationAccountId must be a 0x-prefixed 20-byte Ethereum address for STABLECOIN settlement.',
      };
    }

    const token = this.tokens.find((t) => t.currency === input.currency);
    if (!token) {
      return {
        providerRef: `openfireblocks-unknown-token-${input.transactionId}`,
        succeeded: false,
        failureReason: `No stablecoin token is configured for currency ${input.currency}.`,
      };
    }

    const data = encodeErc20Transfer(input.destinationAccountId, input.amountMinor);

    const startResponse = await fetch(`${this.baseUrl}/settlements`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chainId: token.chainId,
        to: token.tokenAddress,
        data,
        value: '0', // an ERC-20 transfer moves the token, not native ETH.
        gasLimit: DEFAULT_GAS_LIMIT,
        nonce: 0, // OpenFireblocks' own SignRequestDto requires a caller-supplied nonce today -- real nonce management (per-signer sequencing) is separate work this adapter does not attempt; see README caveat.
      }),
    });

    if (!startResponse.ok) {
      return {
        providerRef: `openfireblocks-start-failed-${input.transactionId}`,
        succeeded: false,
        failureReason: `OpenFireblocks /settlements returned ${startResponse.status}`,
      };
    }

    const { workflowId } = (await startResponse.json()) as OpenFireblocksStartResponse;

    return this.pollUntilTerminal(workflowId);
  }

  private async pollUntilTerminal(workflowId: string): Promise<SettlementSubmissionResult> {
    const deadline = Date.now() + this.pollTimeoutMs;

    while (Date.now() < deadline) {
      const statusResponse = await fetch(`${this.baseUrl}/settlements/${workflowId}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });

      if (statusResponse.ok) {
        const body = (await statusResponse.json()) as OpenFireblocksStatusResponse;
        if (body.result) {
          const succeeded = body.result.status === 'confirmed' || body.result.status === 'broadcasted';
          return {
            providerRef: body.result.txHash || workflowId,
            succeeded,
            ...(succeeded ? {} : { failureReason: body.result.reason || `settlement status: ${body.result.status}` }),
          };
        }
      }

      await sleep(this.pollIntervalMs);
    }

    // Honest "not yet known" rather than a fabricated success or failure --
    // the workflow is still real and running in OpenFireblocks (it may
    // still be waiting on the up-to-one-hour human approval window); this
    // adapter simply stopped waiting for it within this request.
    return {
      providerRef: workflowId,
      succeeded: false,
      failureReason: `OpenFireblocks settlement ${workflowId} did not reach a terminal state within ${this.pollTimeoutMs}ms -- it may still be awaiting approval or confirmation. Check GET /settlements/${workflowId} directly.`,
    };
  }
}

export function createOpenFireblocksSettlementProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): OpenFireblocksSettlementProvider | undefined {
  const apiKey = env['OPENFIREBLOCKS_API_KEY'];
  if (!apiKey) return undefined;

  const baseUrl = env['OPENFIREBLOCKS_BASE_URL'];
  if (!baseUrl) {
    throw new Error(
      'OPENFIREBLOCKS_API_KEY is set, but OPENFIREBLOCKS_BASE_URL is not -- ' +
        'set it to your OpenFireblocks api-gateway URL (e.g. http://localhost:3000 for the local docker-compose stack).',
    );
  }

  const tokensJson = env['OPENFIREBLOCKS_STABLECOIN_TOKENS'];
  if (!tokensJson) {
    throw new Error(
      'OPENFIREBLOCKS_API_KEY is set, but OPENFIREBLOCKS_STABLECOIN_TOKENS is not -- ' +
        'set it to a JSON array of {currency, chainId, tokenAddress, decimals}, ' +
        'e.g. [{"currency":"USDC","chainId":11155111,"tokenAddress":"0x...","decimals":6}] for a Sepolia USDC pilot.',
    );
  }

  let tokens: StablecoinTokenConfig[];
  try {
    tokens = JSON.parse(tokensJson) as StablecoinTokenConfig[];
  } catch {
    throw new Error('OPENFIREBLOCKS_STABLECOIN_TOKENS is not valid JSON.');
  }

  return new OpenFireblocksSettlementProvider(apiKey, baseUrl, tokens);
}
