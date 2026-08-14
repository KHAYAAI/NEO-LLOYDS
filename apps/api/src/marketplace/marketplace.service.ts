import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  DomainError,
  matchesAppetite,
  money,
  rankListings,
  requireAnyRole,
  requireTenantAccess,
  type AuthContext,
  type CapitalAppetite,
  type Money as MoneyType,
} from '@neo-lloyds/domain';
import {
  CLOCK,
  GRAPH_REPOSITORY,
  MARKETPLACE_REPOSITORY,
  SUBMISSION_REPOSITORY,
  UNDERWRITING_REPOSITORY,
  type Clock,
  type GraphRepository,
  type MarketplaceRepository,
  type StoredListing,
  type SubmissionRepository,
  type UnderwritingRepository,
} from '../persistence/ports.js';
import { AuditService } from '../common/audit.service.js';
import { UnderwritingService } from '../underwriting/underwriting.service.js';

/**
 * Marketplace (brief §8): listing a cleared, underwritten risk, capital
 * providers declaring appetite, and expressions of interest. Deliberately
 * stops short of syndication — dividing capacity between providers and
 * binding it is Phase 5, and doing it here would blur the "risk originator
 * -> marketplace -> capital" boundary the architecture keeps separate
 * (docs/neo-lloyds-architecture.md §1).
 */
@Injectable()
export class MarketplaceService {
  constructor(
    @Inject(GRAPH_REPOSITORY) private readonly graphRepo: GraphRepository,
    @Inject(SUBMISSION_REPOSITORY) private readonly submissions: SubmissionRepository,
    @Inject(UNDERWRITING_REPOSITORY) private readonly underwritingRepo: UnderwritingRepository,
    @Inject(MARKETPLACE_REPOSITORY) private readonly marketplace: MarketplaceRepository,
    @Inject(UnderwritingService) private readonly underwriting: UnderwritingService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Lists a submission. Requires: the submission is READY_FOR_UNDERWRITING,
   * and the underlying risk is cleared right now (re-checked, not cached —
   * a later-revoked approval must not leave a stale listing standing).
   */
  async listSubmission(
    ctx: AuthContext,
    input: { submissionId: string; riskClass: string; capacity: MoneyType; durationDays: number },
  ): Promise<StoredListing> {
    requireAnyRole(ctx, ['RISK_ORIGINATOR', 'BROKER']);

    const submission = await this.submissions.find(input.submissionId);
    if (!submission) throw new NotFoundException('Submission not found');
    requireTenantAccess(ctx, submission.organisationId, 'WRITE');

    if (submission.status !== 'READY_FOR_UNDERWRITING') {
      throw new DomainError(
        `Submission must be READY_FOR_UNDERWRITING to be listed, is ${submission.status}`,
        'SUBMISSION_NOT_READY',
        { submissionId: submission.id, status: submission.status },
      );
    }

    // Throws APPROVAL_REQUIRED / STALE_APPROVAL / NOT_APPROVED / NOT_ASSESSED
    // if the risk is not currently clear — this is the enforcement point.
    await this.underwriting.requireClearance(ctx, submission.riskId);

    const existing = await this.marketplace.findListingBySubmission(submission.id);
    if (existing) {
      throw new DomainError('This submission is already listed', 'ALREADY_LISTED', {
        submissionId: submission.id,
        listingId: existing.id,
      });
    }

    const riskNode = await this.graphRepo.findNode(submission.riskId);
    const listing = await this.marketplace.createListing({
      id: randomUUID(),
      organisationId: ctx.organisationId,
      submissionId: submission.id,
      riskId: submission.riskId,
      title: submission.title,
      riskClass: input.riskClass,
      jurisdiction: riskNode?.jurisdiction ?? 'ZA',
      capacity: input.capacity,
      durationDays: input.durationDays,
    });

    await this.audit.record({
      ctx,
      action: 'marketplace.listing.create',
      subjectType: 'MarketListing',
      subjectId: listing.id,
      decision: 'ALLOWED',
      reason: `Listed submission ${submission.id} for risk class ${input.riskClass}`,
      after: listing,
    });

    return listing;
  }

  async withdrawListing(ctx: AuthContext, listingId: string): Promise<void> {
    const listing = await this.marketplace.findListing(listingId);
    if (!listing) throw new NotFoundException('Listing not found');
    requireTenantAccess(ctx, listing.organisationId, 'WRITE');

    await this.marketplace.setListingStatus(listingId, 'WITHDRAWN', this.clock.now());

    await this.audit.record({
      ctx,
      action: 'marketplace.listing.withdraw',
      subjectType: 'MarketListing',
      subjectId: listingId,
      decision: 'ALLOWED',
      reason: 'Listing withdrawn by originator',
    });
  }

  async getListing(ctx: AuthContext, id: string): Promise<StoredListing> {
    const listing = await this.marketplace.findListing(id);
    if (!listing) throw new NotFoundException('Listing not found');
    // Open listings are marketplace-visible to any authenticated organisation;
    // only the owner may see a withdrawn/matched/expired one.
    if (listing.status !== 'OPEN') requireTenantAccess(ctx, listing.organisationId, 'READ');
    return listing;
  }

  async browseListings(filter: { riskClass?: string; jurisdiction?: string }): Promise<StoredListing[]> {
    return this.marketplace.listOpenListings(filter);
  }

  async setAppetite(
    ctx: AuthContext,
    profile: Omit<CapitalAppetite, 'organisationId'>,
  ): Promise<CapitalAppetite> {
    requireAnyRole(ctx, ['CAPITAL_PROVIDER']);

    const stored = await this.marketplace.upsertAppetite({
      ...profile,
      organisationId: ctx.organisationId,
    });

    await this.audit.record({
      ctx,
      action: 'marketplace.appetite.set',
      subjectType: 'CapitalAppetiteProfile',
      subjectId: ctx.organisationId,
      decision: 'ALLOWED',
      reason: 'Capital appetite profile updated',
      after: stored,
    });

    return stored;
  }

  async getAppetite(ctx: AuthContext): Promise<CapitalAppetite> {
    const appetite = await this.marketplace.findAppetite(ctx.organisationId);
    if (!appetite) throw new NotFoundException('No appetite profile set for this organisation');
    return appetite;
  }

  /** Ranks currently open listings against the caller's declared appetite. */
  async matchingListings(ctx: AuthContext) {
    const appetite = await this.marketplace.findAppetite(ctx.organisationId);
    if (!appetite) throw new NotFoundException('No appetite profile set for this organisation');

    const listings = await this.marketplace.listOpenListings({});
    return rankListings(
      listings.map((l) => ({
        id: l.id,
        riskClass: l.riskClass,
        jurisdiction: l.jurisdiction,
        capacity: l.capacity,
        durationDays: l.durationDays,
      })),
      appetite,
    );
  }

  async expressInterest(
    ctx: AuthContext,
    listingId: string,
    indicativeAmount: MoneyType,
    note?: string,
  ) {
    requireAnyRole(ctx, ['CAPITAL_PROVIDER']);

    const listing = await this.marketplace.findListing(listingId);
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.status !== 'OPEN') {
      throw new DomainError('Cannot express interest in a listing that is not OPEN', 'LISTING_NOT_OPEN', {
        listingId,
        status: listing.status,
      });
    }

    const appetite = await this.marketplace.findAppetite(ctx.organisationId);
    if (appetite) {
      // Advisory, not blocking: a provider may still express interest outside
      // its declared appetite, but the mismatch is recorded, not hidden.
      const match = matchesAppetite(
        {
          id: listing.id,
          riskClass: listing.riskClass,
          jurisdiction: listing.jurisdiction,
          capacity: listing.capacity,
          durationDays: listing.durationDays,
        },
        appetite,
      );
      if (!match.matches) {
        await this.audit.record({
          ctx,
          action: 'marketplace.interest.outside-appetite',
          subjectType: 'MarketListing',
          subjectId: listingId,
          decision: 'ALLOWED',
          reason: match.reasons.join(' '),
        });
      }
    }

    const interest = await this.marketplace.expressInterest({
      id: randomUUID(),
      listingId,
      organisationId: ctx.organisationId,
      indicativeAmount,
      note: note ?? null,
      expressedAt: this.clock.now(),
    });

    await this.audit.record({
      ctx,
      action: 'marketplace.interest.express',
      subjectType: 'MarketListing',
      subjectId: listingId,
      decision: 'ALLOWED',
      reason: `Indicative interest of ${money(indicativeAmount.amountMinor, indicativeAmount.currency).amountMinor} ${indicativeAmount.currency}`,
      after: interest,
    });

    return interest;
  }

  async withdrawInterest(ctx: AuthContext, listingId: string): Promise<void> {
    await this.marketplace.withdrawInterest(listingId, ctx.organisationId, this.clock.now());
    await this.audit.record({
      ctx,
      action: 'marketplace.interest.withdraw',
      subjectType: 'MarketListing',
      subjectId: listingId,
      decision: 'ALLOWED',
      reason: 'Interest withdrawn',
    });
  }

  async listInterests(ctx: AuthContext, listingId: string) {
    const listing = await this.marketplace.findListing(listingId);
    if (!listing) throw new NotFoundException('Listing not found');
    requireTenantAccess(ctx, listing.organisationId, 'READ');
    return this.marketplace.listInterests(listingId);
  }
}
