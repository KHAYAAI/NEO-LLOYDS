import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  bindAllocations,
  DomainError,
  proposeAllocation,
  removeAllocation as removeAllocationDomain,
  requireAnyRole,
  requireTenantAccess,
  type Allocation,
  type AuthContext,
} from '@neo-lloyds/domain';
import {
  CLOCK,
  MARKETPLACE_REPOSITORY,
  SYNDICATION_REPOSITORY,
  type Clock,
  type MarketplaceRepository,
  type StoredSyndication,
  type SyndicationRepository,
} from '../persistence/ports.js';
import { AuditService } from '../common/audit.service.js';

/**
 * Syndication service (brief §9). This is where a capital provider's
 * expressed interest (Phase 4, non-binding) becomes an actual allocation
 * proposal, and — at exactly one method, {@link bind} — a binding
 * commitment. See `packages/domain/src/syndication.ts` for the pure
 * computation; this service is the persistence, authorisation and audit
 * wrapper around it, same pattern as every other phase.
 *
 * Non-binding vs. binding, stated precisely for this file:
 *   - `open`, `propose`, `withdraw` operate on proposals. Nothing they do
 *     obligates any capital. A proposal can be added and removed freely
 *     while the syndication is OPEN.
 *   - `bind` is the one method that changes that. After it returns, the
 *     allocation amounts are final, the syndication is BOUND, and the
 *     database will refuse (via trigger) any further attempt to alter an
 *     allocation belonging to it — not just the application layer.
 */
@Injectable()
export class SyndicationService {
  constructor(
    @Inject(SYNDICATION_REPOSITORY) private readonly syndications: SyndicationRepository,
    @Inject(MARKETPLACE_REPOSITORY) private readonly marketplace: MarketplaceRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Opens a syndication against a listing. One syndication per listing. */
  async open(ctx: AuthContext, listingId: string): Promise<StoredSyndication> {
    requireAnyRole(ctx, ['RISK_ORIGINATOR', 'BROKER']);

    const listing = await this.marketplace.findListing(listingId);
    if (!listing) throw new NotFoundException('Listing not found');
    requireTenantAccess(ctx, listing.organisationId, 'WRITE');

    if (listing.status !== 'OPEN') {
      throw new DomainError('Only an OPEN listing may be syndicated', 'LISTING_NOT_OPEN', {
        listingId,
        status: listing.status,
      });
    }

    const existing = await this.syndications.findByListing(listingId);
    if (existing) {
      throw new DomainError('This listing already has a syndication', 'ALREADY_SYNDICATED', {
        listingId,
        syndicationId: existing.id,
      });
    }

    const syndication = await this.syndications.create({
      id: randomUUID(),
      listingId,
      organisationId: listing.organisationId,
      capacity: listing.capacity,
    });

    await this.audit.record({
      ctx,
      action: 'syndication.open',
      subjectType: 'Syndication',
      subjectId: syndication.id,
      decision: 'ALLOWED',
      reason: `Opened syndication for listing ${listingId}`,
      after: syndication,
    });

    return syndication;
  }

  /**
   * Proposes an allocation. Requires: the capital provider has a live
   * (non-withdrawn) expression of interest on the underlying listing — this
   * is where Phase 4's `CapitalInterest` finally gets consumed for
   * something real, rather than merely displayed. Still entirely
   * non-binding: enforced here only against the *proposed* 100% ceiling.
   */
  async propose(
    ctx: AuthContext,
    syndicationId: string,
    shareBps: number,
  ): Promise<readonly Allocation[]> {
    requireAnyRole(ctx, ['CAPITAL_PROVIDER']);

    // 'READ' here is deliberate: a capital provider proposing its own
    // allocation does not own the syndication (the listing owner does), so
    // this must not require tenant-write access — only that the syndication
    // is OPEN. Ownership is irrelevant to whether a provider may propose.
    const syndication = await this.requireOpenSyndication(syndicationId, 'READ', ctx);

    const interests = await this.marketplace.listInterests(syndication.listingId);
    const liveInterest = interests.find(
      (i) => i.organisationId === ctx.organisationId && !i.withdrawnAt,
    );
    if (!liveInterest) {
      throw new DomainError(
        'A capital provider must have a live expression of interest on the listing before proposing an allocation',
        'NO_LIVE_INTEREST',
        { syndicationId, listingId: syndication.listingId },
      );
    }

    const current = await this.syndications.listAllocations(syndicationId);
    const appetite = await this.marketplace.findAppetite(ctx.organisationId);

    // Throws DUPLICATE_ALLOCATION / OVER_ALLOCATION / EXPOSURE_LIMIT_EXCEEDED
    // as appropriate. Still a proposal: nothing here commits any capital.
    const updated = proposeAllocation(
      current,
      { organisationId: ctx.organisationId, shareBps },
      syndication.capacity,
      appetite?.maxExposure,
    );
    const added = updated.find((a) => a.organisationId === ctx.organisationId);
    if (!added) throw new Error('Invariant violated: proposed allocation missing after add');

    await this.syndications.addAllocation(
      syndicationId,
      { ...added, id: randomUUID() },
      ctx.subjectId,
    );

    await this.audit.record({
      ctx,
      action: 'syndication.allocation.propose',
      subjectType: 'Syndication',
      subjectId: syndicationId,
      decision: 'ALLOWED',
      reason: `Proposed ${shareBps / 100}% (${added.amount.amountMinor} ${added.amount.currency})`,
      after: added,
    });

    return updated;
  }

  async withdraw(ctx: AuthContext, syndicationId: string): Promise<void> {
    requireAnyRole(ctx, ['CAPITAL_PROVIDER']);
    await this.requireOpenSyndication(syndicationId, 'READ', ctx);

    const current = await this.syndications.listAllocations(syndicationId);
    // Throws ALLOCATION_NOT_FOUND if the caller never proposed one.
    removeAllocationDomain(current, ctx.organisationId);

    await this.syndications.removeAllocation(syndicationId, ctx.organisationId, ctx.subjectId);

    await this.audit.record({
      ctx,
      action: 'syndication.allocation.withdraw',
      subjectType: 'Syndication',
      subjectId: syndicationId,
      decision: 'ALLOWED',
      reason: 'Allocation proposal withdrawn',
    });
  }

  /**
   * THE BINDING CALL.
   *
   * Only the listing owner (the risk originator/broker) may bind — a capital
   * provider cannot bind its own or anyone else's allocation, which would
   * let a single participant force a commitment on the rest of the
   * syndicate. Requires proposals summing to exactly 100%
   * (`bindAllocations` throws `INCOMPLETE_ALLOCATION` otherwise). On success:
   * the syndication is marked BOUND, the listing is marked MATCHED, and the
   * database trigger described in the Phase 5 migration takes over from
   * here — nothing in this codebase can undo it after this call returns.
   */
  async bind(ctx: AuthContext, syndicationId: string): Promise<StoredSyndication> {
    requireAnyRole(ctx, ['RISK_ORIGINATOR', 'BROKER']);

    const syndication = await this.requireOpenSyndication(syndicationId, 'WRITE', ctx);

    const proposals = await this.syndications.listAllocations(syndicationId);
    // Pure computation — see packages/domain/src/syndication.ts. Throws
    // INCOMPLETE_ALLOCATION if proposals do not sum to exactly 100%.
    const finalAllocations = bindAllocations(proposals, syndication.capacity);

    const bound = await this.syndications.bind(
      syndicationId,
      finalAllocations,
      ctx.subjectId,
      this.clock.now(),
    );
    await this.marketplace.setListingStatus(syndication.listingId, 'MATCHED', this.clock.now());

    await this.audit.record({
      ctx,
      action: 'syndication.bind',
      subjectType: 'Syndication',
      subjectId: syndicationId,
      decision: 'ALLOWED',
      reason: `Bound with ${finalAllocations.length} participant(s), capacity ${syndication.capacity.amountMinor} ${syndication.capacity.currency} fully allocated`,
      after: { syndication: bound, allocations: finalAllocations },
    });

    return bound;
  }

  async get(ctx: AuthContext, syndicationId: string): Promise<StoredSyndication> {
    const syndication = await this.syndications.find(syndicationId);
    if (!syndication) throw new NotFoundException('Syndication not found');
    // Allocations and terms are visible to any authenticated participant
    // once a syndication exists to see, but writes remain tenant/role gated.
    return syndication;
  }

  async listAllocations(_ctx: AuthContext, syndicationId: string): Promise<readonly Allocation[]> {
    await this.mustExist(syndicationId);
    return this.syndications.listAllocations(syndicationId);
  }

  async listEvents(_ctx: AuthContext, syndicationId: string) {
    await this.mustExist(syndicationId);
    return this.syndications.listEvents(syndicationId);
  }

  private async mustExist(syndicationId: string): Promise<StoredSyndication> {
    const syndication = await this.syndications.find(syndicationId);
    if (!syndication) throw new NotFoundException('Syndication not found');
    return syndication;
  }

  private async requireOpenSyndication(
    syndicationId: string,
    access: 'READ' | 'WRITE',
    ctx: AuthContext,
  ): Promise<StoredSyndication> {
    const syndication = await this.mustExist(syndicationId);
    if (access === 'WRITE') requireTenantAccess(ctx, syndication.organisationId, 'WRITE');
    if (syndication.status !== 'OPEN') {
      throw new DomainError('Syndication is not OPEN', 'SYNDICATION_NOT_OPEN', {
        syndicationId,
        status: syndication.status,
      });
    }
    return syndication;
  }
}
