import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  computePosition,
  concentrationBy,
  requireAnyRole,
  type AllocationContribution,
  type AuthContext,
  type CapitalPosition,
  type ConcentrationBucket,
  type Money,
} from '@neo-lloyds/domain';
import {
  CAPITAL_REPOSITORY,
  MARKETPLACE_REPOSITORY,
  SYNDICATION_REPOSITORY,
  type CapitalRepository,
  type MarketplaceRepository,
  type SyndicationRepository,
} from '../persistence/ports.js';
import { AuditService } from '../common/audit.service.js';

/**
 * Capital Ledger service (brief §10). Owns two things: setting a provider's
 * committed capital, and computing that provider's current position and
 * concentration — always freshly, from the raw allocation data, never from a
 * separately maintained running total that could drift out of sync with it.
 */
@Injectable()
export class CapitalService {
  constructor(
    @Inject(CAPITAL_REPOSITORY) private readonly capitalRepo: CapitalRepository,
    @Inject(SYNDICATION_REPOSITORY) private readonly syndicationRepo: SyndicationRepository,
    @Inject(MARKETPLACE_REPOSITORY) private readonly marketplace: MarketplaceRepository,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async setCommitment(ctx: AuthContext, committed: Money) {
    requireAnyRole(ctx, ['CAPITAL_PROVIDER']);

    const before = await this.capitalRepo.findCommitment(ctx.organisationId);
    const after = await this.capitalRepo.upsertCommitment(ctx.organisationId, committed);

    await this.audit.record({
      ctx,
      action: 'capital.commitment.set',
      subjectType: 'CapitalCommitment',
      subjectId: ctx.organisationId,
      decision: 'ALLOWED',
      reason: `Committed capital set to ${committed.amountMinor} ${committed.currency}`,
      before,
      after,
    });

    return after;
  }

  async getCommitment(ctx: AuthContext) {
    const commitment = await this.capitalRepo.findCommitment(ctx.organisationId);
    if (!commitment) throw new NotFoundException('No capital commitment recorded for this organisation');
    return commitment;
  }

  /**
   * Builds every {@link AllocationContribution} this organisation holds,
   * across every syndication on the platform, enriched with listing detail
   * for concentration reporting. This — not any single syndication's local
   * check — is what the provider's total exposure is computed from.
   */
  async contributions(organisationId: string): Promise<AllocationContribution[]> {
    const raw = await this.syndicationRepo.listAllocationsForOrganisation(organisationId);
    const contributions: AllocationContribution[] = [];
    for (const item of raw) {
      const listing = await this.marketplace.findListing(item.listingId);
      contributions.push({
        syndicationId: item.syndicationId,
        status: item.status,
        listingId: item.listingId,
        riskClass: listing?.riskClass ?? 'UNKNOWN',
        jurisdiction: listing?.jurisdiction ?? 'ZZ',
        counterpartyOrganisationId: listing?.organisationId ?? 'UNKNOWN',
        amount: item.amount,
      });
    }
    return contributions;
  }

  async position(ctx: AuthContext): Promise<CapitalPosition> {
    requireAnyRole(ctx, ['CAPITAL_PROVIDER']);
    const commitment = await this.getCommitment(ctx);
    const contributions = await this.contributions(ctx.organisationId);
    return computePosition(
      { organisationId: commitment.organisationId, committed: commitment.committed, updatedAt: commitment.updatedAt.toISOString() },
      contributions,
    );
  }

  async concentration(
    ctx: AuthContext,
    by: 'riskClass' | 'jurisdiction' | 'counterparty',
  ): Promise<readonly ConcentrationBucket[]> {
    requireAnyRole(ctx, ['CAPITAL_PROVIDER']);
    const commitment = await this.getCommitment(ctx);
    const contributions = await this.contributions(ctx.organisationId);

    const keyOf =
      by === 'riskClass'
        ? (c: AllocationContribution) => c.riskClass
        : by === 'jurisdiction'
          ? (c: AllocationContribution) => c.jurisdiction
          : (c: AllocationContribution) => c.counterpartyOrganisationId;

    return concentrationBy(contributions, keyOf, commitment.committed.currency);
  }
}
