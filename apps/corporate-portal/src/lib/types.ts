import type { Money } from '@neo-lloyds/domain';

/**
 * Response shapes that exist only at the API layer
 * (`apps/api/src/persistence/ports.ts`), not in `@neo-lloyds/domain` — kept
 * as a hand-matched local copy, same convention as the broker and
 * capital-provider portals.
 */
export interface Claim {
  readonly id: string;
  readonly syndicationId: string;
  readonly riskId: string;
  readonly organisationId: string;
  readonly status:
    | 'REPORTED'
    | 'EVIDENCE_COLLECTED'
    | 'VERIFIED'
    | 'COVERAGE_CONFIRMED'
    | 'LOSS_CALCULATED'
    | 'AWAITING_APPROVAL'
    | 'APPROVED'
    | 'REJECTED'
    | 'SETTLED';
  readonly incidentDescription: string;
  readonly evidenceRefs: readonly string[];
  readonly reportedBy: string;
  readonly claimedLoss: Money | null;
  readonly reviewDecision: 'AUTO' | 'HUMAN_REVIEW' | null;
  readonly approverSubjectId: string | null;
  readonly approvalDecision: 'APPROVED' | 'REJECTED' | null;
  readonly approvalReason: string | null;
  readonly decidedAt: string | null;
  readonly settledAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ClaimPayout {
  readonly claimId: string;
  readonly organisationId: string;
  readonly amount: Money;
}
