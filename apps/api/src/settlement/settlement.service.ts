import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  calculateSettlement,
  requireAnyRole,
  requireSettlementTransition,
  requireTenantAccess,
  type AuthContext,
  type Money,
  type SettlementFeeConfig,
  type SettlementMethod,
} from '@neo-lloyds/domain';
import {
  SETTLEMENT_REPOSITORY,
  type SettlementRepository,
  type StoredSettlementTransaction,
} from '../persistence/ports.js';
import { AuditService } from '../common/audit.service.js';
import { SETTLEMENT_PROVIDER } from './tokens.js';
import type { SettlementProvider } from './providers.js';

/** Configurable, illustrative fee — same caveat as every threshold before it in this system. */
export const DEFAULT_FEE_CONFIG: SettlementFeeConfig = { flatMinor: 50, bps: 25 }; // $0.50 + 0.25%

/**
 * Settlement (roadmap Phase 10). This is where Phase 7's claims "settled"
 * status finally gets real transaction infrastructure behind it: a fee
 * calculation, a transaction record, and a `SettlementProvider` call — one
 * honest implementation of which exists today (see providers.ts).
 */
@Injectable()
export class SettlementService {
  constructor(
    @Inject(SETTLEMENT_REPOSITORY) private readonly repository: SettlementRepository,
    @Inject(SETTLEMENT_PROVIDER) private readonly provider: SettlementProvider,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Creates a settlement transaction, computes its fee, and immediately
   * submits it to the configured provider — a synchronous call chain rather
   * than a queued job, appropriate for a provider that always resolves
   * instantly (the Null provider) and simple to extend once a real,
   * asynchronous provider exists (submit would then leave the transaction
   * SUBMITTED and a webhook/poll would confirm it later).
   */
  async initiate(
    ctx: AuthContext,
    input: {
      claimPayoutOrganisationId: string | null;
      claimPayoutClaimId: string | null;
      method: SettlementMethod;
      grossAmount: Money;
      feeConfig?: SettlementFeeConfig;
    },
  ): Promise<StoredSettlementTransaction> {
    requireAnyRole(ctx, ['CLAIMS_ADMINISTRATOR', 'SETTLEMENT_PROVIDER']);

    const calc = calculateSettlement(input.grossAmount, input.feeConfig ?? DEFAULT_FEE_CONFIG);

    let transaction = await this.repository.create({
      id: randomUUID(),
      organisationId: ctx.organisationId,
      claimPayoutOrganisationId: input.claimPayoutOrganisationId,
      claimPayoutClaimId: input.claimPayoutClaimId,
      method: input.method,
      grossAmount: calc.grossAmount,
      fee: calc.fee,
      netAmount: calc.netAmount,
    });

    requireSettlementTransition(transaction.status, 'SUBMITTED');
    transaction = await this.repository.setStatus(transaction.id, 'SUBMITTED', {});

    const result = await this.provider.submit({
      transactionId: transaction.id,
      method: transaction.method,
      amountMinor: transaction.netAmount.amountMinor,
      currency: transaction.netAmount.currency,
    });

    const finalStatus = result.succeeded ? 'CONFIRMED' : 'FAILED';
    requireSettlementTransition('SUBMITTED', finalStatus);
    transaction = await this.repository.setStatus(transaction.id, finalStatus, {
      providerRef: result.providerRef,
      ...(result.failureReason ? { failureReason: result.failureReason } : {}),
    });

    await this.audit.record({
      ctx,
      action: 'settlement.initiate',
      subjectType: 'SettlementTransaction',
      subjectId: transaction.id,
      decision: result.succeeded ? 'ALLOWED' : 'DENIED',
      reason: `${transaction.method} settlement of ${calc.netAmount.amountMinor} ${calc.netAmount.currency} (fee ${calc.fee.amountMinor}) via ${this.provider.providerId}: ${finalStatus}`,
      after: transaction,
    });

    return transaction;
  }

  async get(ctx: AuthContext, id: string): Promise<StoredSettlementTransaction> {
    const transaction = await this.mustFind(id);
    requireTenantAccess(ctx, transaction.organisationId, 'READ');
    return transaction;
  }

  async list(ctx: AuthContext): Promise<StoredSettlementTransaction[]> {
    return this.repository.listByOrganisation(ctx.organisationId);
  }

  private async mustFind(id: string): Promise<StoredSettlementTransaction> {
    const transaction = await this.repository.find(id);
    if (!transaction) throw new NotFoundException('Settlement transaction not found');
    return transaction;
  }
}
