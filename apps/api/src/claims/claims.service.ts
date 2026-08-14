import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  classifyReview,
  computeClaimPayouts,
  DomainError,
  requireAnyRole,
  requireClaimApprovalIfNeeded,
  requireClaimTransition,
  requireCoverage,
  requireTenantAccess,
  type AuthContext,
  type Money,
} from '@neo-lloyds/domain';
import {
  CLAIMS_REPOSITORY,
  CLOCK,
  SYNDICATION_REPOSITORY,
  type Clock,
  type ClaimsRepository,
  type StoredClaim,
  type SyndicationRepository,
} from '../persistence/ports.js';
import { AuditService } from '../common/audit.service.js';

/** Configurable per jurisdiction/product — this is the Phase 7 default. Same
 *  caveat as Phase 3's DEFAULT_APPROVAL_THRESHOLDS: illustrative, USD-only,
 *  not calibrated against real loss history (docs/reports/phase-7.md). */
export const DEFAULT_AUTO_APPROVAL_CEILING: Money = { amountMinor: 25_000_00, currency: 'USD' };

/**
 * Claims service (brief §13). Every method here composes the pure functions
 * in `packages/domain/src/claims.ts` with persistence, tenant authorisation
 * and audit — same pattern as every prior phase. The one method where a
 * bound syndication's allocation is actually tested against a loss is
 * {@link calculateLoss}: everything before it is process (evidence,
 * verification), everything after it is a decision about what was already
 * computed there.
 */
@Injectable()
export class ClaimsService {
  constructor(
    @Inject(CLAIMS_REPOSITORY) private readonly claims: ClaimsRepository,
    @Inject(SYNDICATION_REPOSITORY) private readonly syndications: SyndicationRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async report(
    ctx: AuthContext,
    input: { syndicationId: string; riskId: string; incidentDescription: string },
  ): Promise<StoredClaim> {
    requireAnyRole(ctx, ['RISK_ORIGINATOR', 'BROKER']);

    const syndication = await this.syndications.find(input.syndicationId);
    if (!syndication) throw new NotFoundException('Syndication not found');
    // Only the originator that owns the syndicated risk may report a loss
    // against it — not a bystander, and not a capital provider (who reports
    // nothing; it only ever responds to what has already been assessed).
    requireTenantAccess(ctx, syndication.organisationId, 'WRITE');

    const claim = await this.claims.create({
      id: randomUUID(),
      syndicationId: input.syndicationId,
      riskId: input.riskId,
      organisationId: ctx.organisationId,
      incidentDescription: input.incidentDescription,
      reportedBy: ctx.subjectId,
    });

    await this.audit.record({
      ctx,
      action: 'claims.report',
      subjectType: 'Claim',
      subjectId: claim.id,
      decision: 'ALLOWED',
      reason: `Incident reported against syndication ${input.syndicationId}`,
      after: claim,
    });

    return claim;
  }

  async addEvidence(ctx: AuthContext, claimId: string, evidenceRef: string): Promise<StoredClaim> {
    requireAnyRole(ctx, ['RISK_ORIGINATOR', 'BROKER', 'CLAIMS_ADMINISTRATOR']);
    const claim = await this.mustFind(claimId);
    requireTenantAccess(ctx, claim.organisationId, 'WRITE');

    const updated = await this.claims.addEvidence(claimId, evidenceRef);

    await this.audit.record({
      ctx,
      action: 'claims.evidence.add',
      subjectType: 'Claim',
      subjectId: claimId,
      decision: 'ALLOWED',
      reason: `Evidence attached: ${evidenceRef}`,
      after: updated,
    });

    return updated;
  }

  /**
   * Generic forward-only transitions for the process steps that carry no
   * extra data of their own: REPORTED -> EVIDENCE_COLLECTED -> VERIFIED ->
   * COVERAGE_CONFIRMED. Loss calculation is its own method because it is
   * where the real coverage test happens, not a generic step.
   */
  async advance(ctx: AuthContext, claimId: string, to: StoredClaim['status']): Promise<StoredClaim> {
    requireAnyRole(ctx, ['CLAIMS_ADMINISTRATOR']);
    const claim = await this.mustFind(claimId);
    requireTenantAccess(ctx, claim.organisationId, 'READ');

    requireClaimTransition(claim.status, to);

    if (to === 'COVERAGE_CONFIRMED') {
      // A syndication that isn't BOUND has no capacity to confirm coverage
      // against at all — checked here even before a loss amount exists.
      const syndication = await this.syndications.find(claim.syndicationId);
      if (!syndication) throw new NotFoundException('Syndication not found');
      if (syndication.status !== 'BOUND') {
        throw new DomainError(
          'Cannot confirm coverage: the syndication is not BOUND',
          'SYNDICATION_NOT_BOUND',
          { syndicationId: claim.syndicationId, status: syndication.status },
        );
      }
    }

    const updated = await this.claims.setStatus(claimId, to);

    await this.audit.record({
      ctx,
      action: 'claims.transition',
      subjectType: 'Claim',
      subjectId: claimId,
      decision: 'ALLOWED',
      reason: `${claim.status} -> ${to}`,
      before: claim,
      after: updated,
    });

    return updated;
  }

  /**
   * THE COVERAGE TEST. Checks the claimed loss against the syndication's
   * bound capacity — net of every prior APPROVED or SETTLED claim already
   * recorded against the same syndication — and classifies the claim as
   * AUTO or HUMAN_REVIEW against the configured threshold. This is the
   * method where a bound allocation stops being a capital position and
   * becomes something actually tested against a real number.
   */
  async calculateLoss(
    ctx: AuthContext,
    claimId: string,
    claimedLoss: Money,
    autoApprovalCeiling: Money = DEFAULT_AUTO_APPROVAL_CEILING,
  ): Promise<StoredClaim> {
    requireAnyRole(ctx, ['CLAIMS_ADMINISTRATOR']);
    const claim = await this.mustFind(claimId);
    requireTenantAccess(ctx, claim.organisationId, 'READ');
    requireClaimTransition(claim.status, 'LOSS_CALCULATED');

    const syndication = await this.syndications.find(claim.syndicationId);
    if (!syndication) throw new NotFoundException('Syndication not found');

    const priorApprovedLoss = await this.claims.totalApprovedLoss(
      claim.syndicationId,
      claimedLoss.currency,
    );
    // Throws SYNDICATION_NOT_BOUND / LOSS_EXCEEDS_REMAINING_CAPACITY.
    requireCoverage(syndication, priorApprovedLoss, claimedLoss);

    const review = classifyReview(claimedLoss, autoApprovalCeiling);
    const nextStatus = review === 'AUTO' ? 'APPROVED' : 'AWAITING_APPROVAL';
    // Both are legal from LOSS_CALCULATED — requireClaimTransition above only
    // confirmed the claim could reach LOSS_CALCULATED at all; this second
    // check confirms the specific next state the review decision selects.
    requireClaimTransition('LOSS_CALCULATED', nextStatus);

    const updated = await this.claims.setLoss(claimId, claimedLoss, review, nextStatus);

    let final = updated;
    if (review === 'AUTO') {
      final = await this.recordPayoutsAndAudit(ctx, claim.syndicationId, updated, 'auto-approved');
    }

    await this.audit.record({
      ctx,
      action: 'claims.loss.calculate',
      subjectType: 'Claim',
      subjectId: claimId,
      decision: 'ALLOWED',
      reason: `Loss calculated at ${claimedLoss.amountMinor} ${claimedLoss.currency}; review=${review}`,
      after: final,
      policy: review,
    });

    return final;
  }

  /**
   * Records a human decision on a HUMAN_REVIEW claim. Only a
   * CLAIMS_ADMINISTRATOR may approve — mirrors the UNDERWRITER-only
   * approval gate from Phase 3.
   */
  async decide(
    ctx: AuthContext,
    claimId: string,
    decision: 'APPROVED' | 'REJECTED',
    reason: string,
  ): Promise<StoredClaim> {
    requireAnyRole(ctx, ['CLAIMS_ADMINISTRATOR']);
    const claim = await this.mustFind(claimId);
    requireTenantAccess(ctx, claim.organisationId, 'READ');

    if (claim.status !== 'AWAITING_APPROVAL') {
      throw new DomainError('Only a claim AWAITING_APPROVAL may be decided', 'CLAIM_NOT_AWAITING_APPROVAL', {
        claimId,
        status: claim.status,
      });
    }
    requireClaimTransition('AWAITING_APPROVAL', decision);

    const decidedAt = this.clock.now();
    const updated = await this.claims.setApproval(
      claimId,
      ctx.subjectId,
      decision,
      reason,
      decidedAt,
      decision,
    );

    // Confirms an APPROVED decision actually satisfies the domain gate
    // before payouts are computed — belt and braces alongside the state
    // machine transition check above. Only meaningful for APPROVED: a
    // REJECTED decision is itself a legitimate terminal outcome, and
    // requireClaimApprovalIfNeeded would (correctly, for its own purpose)
    // reject any non-APPROVED decision, so it must not be asked to bless one.
    if (decision === 'APPROVED') {
      requireClaimApprovalIfNeeded('HUMAN_REVIEW', {
        claimId,
        decision,
        approverSubjectId: ctx.subjectId,
        reason,
        decidedAt: decidedAt.toISOString(),
      });
    }

    let final = updated;
    if (decision === 'APPROVED') {
      final = await this.recordPayoutsAndAudit(ctx, claim.syndicationId, updated, 'human-approved');
    }

    await this.audit.record({
      ctx,
      action: 'claims.decide',
      subjectType: 'Claim',
      subjectId: claimId,
      decision: decision === 'APPROVED' ? 'ALLOWED' : 'DENIED',
      reason,
      after: final,
    });

    return final;
  }

  /** Marks an APPROVED claim SETTLED. Real settlement infrastructure is Phase 10. */
  async settle(ctx: AuthContext, claimId: string): Promise<StoredClaim> {
    requireAnyRole(ctx, ['CLAIMS_ADMINISTRATOR', 'SETTLEMENT_PROVIDER']);
    const claim = await this.mustFind(claimId);
    requireTenantAccess(ctx, claim.organisationId, 'READ');
    requireClaimTransition(claim.status, 'SETTLED');

    const updated = await this.claims.setSettled(claimId, this.clock.now());

    await this.audit.record({
      ctx,
      action: 'claims.settle',
      subjectType: 'Claim',
      subjectId: claimId,
      decision: 'ALLOWED',
      reason: 'Marked settled (test settlement infrastructure — see docs/reports/phase-7.md)',
      after: updated,
    });

    return updated;
  }

  async get(ctx: AuthContext, claimId: string): Promise<StoredClaim> {
    const claim = await this.mustFind(claimId);
    requireTenantAccess(ctx, claim.organisationId, 'READ');
    return claim;
  }

  async listBySyndication(ctx: AuthContext, syndicationId: string) {
    const syndication = await this.syndications.find(syndicationId);
    if (!syndication) throw new NotFoundException('Syndication not found');
    requireTenantAccess(ctx, syndication.organisationId, 'READ');
    return this.claims.listBySyndication(syndicationId);
  }

  async listPayouts(ctx: AuthContext, claimId: string) {
    const claim = await this.mustFind(claimId);
    requireTenantAccess(ctx, claim.organisationId, 'READ');
    return this.claims.listPayouts(claimId);
  }

  private async mustFind(claimId: string): Promise<StoredClaim> {
    const claim = await this.claims.find(claimId);
    if (!claim) throw new NotFoundException('Claim not found');
    return claim;
  }

  private async recordPayoutsAndAudit(
    ctx: AuthContext,
    syndicationId: string,
    claim: StoredClaim,
    label: string,
  ): Promise<StoredClaim> {
    if (!claim.claimedLoss) throw new Error('Invariant violated: approving a claim with no calculated loss');

    const boundAllocations = await this.syndications.listAllocations(syndicationId);
    const payouts = computeClaimPayouts(claim.claimedLoss, boundAllocations);
    await this.claims.recordPayouts(claim.id, payouts.map((p) => ({ claimId: claim.id, ...p })));

    await this.audit.record({
      ctx,
      action: 'claims.payouts.compute',
      subjectType: 'Claim',
      subjectId: claim.id,
      decision: 'ALLOWED',
      reason: `Payouts computed across ${payouts.length} provider(s) (${label})`,
      after: payouts,
    });

    return claim;
  }
}
