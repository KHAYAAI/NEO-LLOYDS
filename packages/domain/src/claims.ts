import { DomainError } from './errors.js';
import { allocateMoney, compareMoney, subtractMoney, type Money } from './money.js';
import type { Allocation } from './syndication.js';

/**
 * Claims (brief §13). This is the first phase where a bound syndication's
 * capacity is tested against something real rather than merely held: a
 * claimed loss either fits inside what was actually committed, or it does
 * not, and that is checked exactly — including against every prior claim
 * already recorded on the same syndication, not just this one in isolation.
 *
 * Parametric triggers (brief §12) are deliberately out of scope here: they
 * are event-triggered payments verified against a data feed, not a loss
 * calculated from evidence, and the brief requires them to stay a separate
 * engine so their logic is never confused with indemnity adjudication.
 */

export const CLAIM_STATUSES = [
  'REPORTED',
  'EVIDENCE_COLLECTED',
  'VERIFIED',
  'COVERAGE_CONFIRMED',
  'LOSS_CALCULATED',
  'AWAITING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'SETTLED',
] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/**
 * Forward-only, same discipline as the risk-submission workflow (Phase 2).
 * `LOSS_CALCULATED` has two legal next states because the review decision —
 * computed by {@link classifyReview}, not chosen freely — determines which
 * one applies: a low-value claim may go straight to `APPROVED`, a high-value
 * one must pass through `AWAITING_APPROVAL` first.
 */
const CLAIM_TRANSITIONS: Readonly<Record<ClaimStatus, readonly ClaimStatus[]>> = Object.freeze({
  REPORTED: ['EVIDENCE_COLLECTED'],
  EVIDENCE_COLLECTED: ['VERIFIED'],
  VERIFIED: ['COVERAGE_CONFIRMED'],
  COVERAGE_CONFIRMED: ['LOSS_CALCULATED'],
  LOSS_CALCULATED: ['AWAITING_APPROVAL', 'APPROVED'],
  AWAITING_APPROVAL: ['APPROVED', 'REJECTED'],
  APPROVED: ['SETTLED'],
  REJECTED: [],
  SETTLED: [],
});

export function canTransitionClaim(from: ClaimStatus, to: ClaimStatus): boolean {
  return CLAIM_TRANSITIONS[from].includes(to);
}

export function requireClaimTransition(from: ClaimStatus, to: ClaimStatus): void {
  if (!canTransitionClaim(from, to)) {
    throw new DomainError(`A claim cannot move from ${from} to ${to}`, 'INVALID_CLAIM_TRANSITION', {
      from,
      to,
    });
  }
}

/**
 * THE COVERAGE TEST. A claim may only be calculated against a syndication
 * that is actually BOUND — an OPEN or CANCELLED syndication was never a real
 * commitment, so there is nothing to test a loss against. And the claimed
 * loss, added to every prior APPROVED or SETTLED claim already recorded
 * against the same syndication, must never exceed the capacity that was
 * bound. This is the running-total check: a syndication with $100,000 bound
 * capacity that has already paid a $60,000 claim can accept at most $40,000
 * more, ever — checked here, not trusted to whoever is filing the claim.
 */
export function requireCoverage(
  syndication: { status: 'OPEN' | 'BOUND' | 'CANCELLED'; capacity: Money },
  priorApprovedLoss: Money,
  claimedLoss: Money,
): void {
  if (syndication.status !== 'BOUND') {
    throw new DomainError(
      'A claim can only be tested against a BOUND syndication; there is no committed capacity to test it against',
      'SYNDICATION_NOT_BOUND',
      { status: syndication.status },
    );
  }

  const remaining = subtractMoney(syndication.capacity, priorApprovedLoss);
  if (compareMoney(claimedLoss, remaining) > 0) {
    throw new DomainError(
      'Claimed loss exceeds the capacity remaining on this syndication after prior claims',
      'LOSS_EXCEEDS_REMAINING_CAPACITY',
      {
        claimedLoss,
        remaining,
        capacity: syndication.capacity,
        priorApprovedLoss,
      },
    );
  }
}

export type ReviewDecision = 'AUTO' | 'HUMAN_REVIEW';

/**
 * Below the threshold: automated processing (brief §13). At or above it:
 * mandatory human review. There is no code path that skips this — a claim
 * above threshold cannot reach APPROVED without a recorded ClaimApproval
 * (enforced by {@link requireClaimApprovalIfNeeded}), mirroring the
 * underwriting approval gate from Phase 3.
 */
export function classifyReview(claimedLoss: Money, autoApprovalCeiling: Money): ReviewDecision {
  if (claimedLoss.currency !== autoApprovalCeiling.currency) {
    throw new DomainError(
      'Claim review threshold is currency-scoped; convert before classifying',
      'CURRENCY_MISMATCH',
      { claimCurrency: claimedLoss.currency, thresholdCurrency: autoApprovalCeiling.currency },
    );
  }
  return compareMoney(claimedLoss, autoApprovalCeiling) <= 0 ? 'AUTO' : 'HUMAN_REVIEW';
}

export interface ClaimApproval {
  readonly claimId: string;
  readonly decision: 'APPROVED' | 'REJECTED';
  readonly approverSubjectId: string;
  readonly reason: string;
  readonly decidedAt: string;
}

export function requireClaimApprovalIfNeeded(
  review: ReviewDecision,
  approval: ClaimApproval | undefined,
): void {
  if (review === 'AUTO') return;
  if (!approval) {
    throw new DomainError(
      'A claim above the automated-processing threshold requires a recorded human decision',
      'CLAIM_APPROVAL_REQUIRED',
      {},
    );
  }
  if (approval.decision !== 'APPROVED') {
    throw new DomainError('This claim was not approved', 'CLAIM_NOT_APPROVED', {
      decision: approval.decision,
    });
  }
}

export interface ClaimPayout {
  readonly organisationId: string;
  readonly amount: Money;
}

/**
 * Divides an approved loss across the capital providers who bound the
 * syndication, in proportion to their bound share — using the same
 * exact-sum allocation as binding itself (ADR-0005), so a claim payout can
 * never lose or invent a minor unit either. This is the concrete moment a
 * capital provider's allocation is tested: what it committed to bear is what
 * it now actually pays, in exact proportion to its share.
 */
export function computeClaimPayouts(
  loss: Money,
  boundAllocations: readonly Allocation[],
): readonly ClaimPayout[] {
  if (boundAllocations.length === 0) {
    throw new DomainError('Cannot compute payouts with no bound allocations', 'NO_BOUND_ALLOCATIONS', {});
  }
  const amounts = allocateMoney(
    loss,
    boundAllocations.map((a) => a.shareBps),
  );
  return boundAllocations.map((allocation, index) => ({
    organisationId: allocation.organisationId,
    amount: amounts[index] as Money,
  }));
}
