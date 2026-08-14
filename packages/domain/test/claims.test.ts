import { describe, expect, it } from 'vitest';
import {
  canTransitionClaim,
  classifyReview,
  computeClaimPayouts,
  DomainError,
  money,
  requireClaimApprovalIfNeeded,
  requireClaimTransition,
  requireCoverage,
  type Allocation,
  type ClaimApproval,
} from '../src/index.js';

const boundSyndication = { status: 'BOUND' as const, capacity: money(100_000, 'USD') };
const openSyndication = { status: 'OPEN' as const, capacity: money(100_000, 'USD') };
const zero = money(0, 'USD');

describe('requireCoverage: the coverage test', () => {
  it('refuses a claim against a syndication that is not BOUND', () => {
    expect(() => requireCoverage(openSyndication, zero, money(1, 'USD'))).toThrow(DomainError);
    try {
      requireCoverage(openSyndication, zero, money(1, 'USD'));
    } catch (error) {
      expect((error as DomainError).code).toBe('SYNDICATION_NOT_BOUND');
    }
  });

  it('allows a claim within capacity with no prior claims', () => {
    expect(() => requireCoverage(boundSyndication, zero, money(60_000, 'USD'))).not.toThrow();
  });

  it('allows a claim that exactly exhausts remaining capacity', () => {
    expect(() => requireCoverage(boundSyndication, zero, money(100_000, 'USD'))).not.toThrow();
  });

  it('refuses a claim exceeding capacity outright', () => {
    expect(() => requireCoverage(boundSyndication, zero, money(100_001, 'USD'))).toThrow(DomainError);
  });

  it('enforces the running total: a second claim cannot exceed what remains after the first', () => {
    // $100,000 bound. A prior claim already took $60,000. Only $40,000 remains.
    const priorApprovedLoss = money(60_000, 'USD');
    expect(() => requireCoverage(boundSyndication, priorApprovedLoss, money(40_000, 'USD'))).not.toThrow();

    const overRemaining = () => requireCoverage(boundSyndication, priorApprovedLoss, money(40_001, 'USD'));
    expect(overRemaining).toThrow(DomainError);
    try {
      overRemaining();
    } catch (error) {
      const details = (error as DomainError).details;
      expect(details['remaining']).toEqual(money(40_000, 'USD'));
    }
  });

  it('refuses any further claim once prior claims have exhausted capacity entirely', () => {
    const exhausted = money(100_000, 'USD');
    expect(() => requireCoverage(boundSyndication, exhausted, money(1, 'USD'))).toThrow(DomainError);
  });
});

describe('classifyReview', () => {
  const threshold = money(25_000, 'USD');

  it('classifies a claim at or below threshold as AUTO', () => {
    expect(classifyReview(money(10_000, 'USD'), threshold)).toBe('AUTO');
    expect(classifyReview(money(25_000, 'USD'), threshold)).toBe('AUTO');
  });

  it('classifies a claim above threshold as HUMAN_REVIEW', () => {
    expect(classifyReview(money(25_001, 'USD'), threshold)).toBe('HUMAN_REVIEW');
  });

  it('rejects a currency mismatch rather than silently comparing', () => {
    expect(() => classifyReview(money(1, 'ZAR'), threshold)).toThrow(DomainError);
  });
});

describe('requireClaimApprovalIfNeeded', () => {
  it('never blocks an AUTO claim, even with no approval recorded', () => {
    expect(() => requireClaimApprovalIfNeeded('AUTO', undefined)).not.toThrow();
  });

  it('blocks a HUMAN_REVIEW claim with no approval recorded', () => {
    expect(() => requireClaimApprovalIfNeeded('HUMAN_REVIEW', undefined)).toThrow(DomainError);
  });

  it('blocks a HUMAN_REVIEW claim with a REJECTED decision', () => {
    const rejected: ClaimApproval = {
      claimId: 'claim-1',
      decision: 'REJECTED',
      approverSubjectId: 'user-1',
      reason: 'insufficient evidence',
      decidedAt: '2026-08-14T00:00:00Z',
    };
    expect(() => requireClaimApprovalIfNeeded('HUMAN_REVIEW', rejected)).toThrow(DomainError);
  });

  it('accepts a HUMAN_REVIEW claim with an APPROVED decision', () => {
    const approved: ClaimApproval = {
      claimId: 'claim-1',
      decision: 'APPROVED',
      approverSubjectId: 'user-1',
      reason: 'evidence sufficient',
      decidedAt: '2026-08-14T00:00:00Z',
    };
    expect(() => requireClaimApprovalIfNeeded('HUMAN_REVIEW', approved)).not.toThrow();
  });
});

describe('computeClaimPayouts: the moment a bound allocation is actually tested', () => {
  function allocation(organisationId: string, shareBps: number, amountMinor: number): Allocation {
    return { organisationId, shareBps, amount: money(amountMinor, 'USD') };
  }

  it('divides a loss across bound allocations in exact proportion, summing exactly to the loss', () => {
    const allocations = [
      allocation('provider-a', 3334, 33_340),
      allocation('provider-b', 3333, 33_330),
      allocation('provider-c', 3333, 33_330),
    ];
    const payouts = computeClaimPayouts(money(100_000, 'USD'), allocations);
    const sum = payouts.reduce((acc, p) => acc + p.amount.amountMinor, 0);
    expect(sum).toBe(100_000);
    expect(payouts.map((p) => p.organisationId)).toEqual(['provider-a', 'provider-b', 'provider-c']);
  });

  it('handles a partial loss, still summing exactly to the claimed amount, not the full capacity', () => {
    const allocations = [allocation('provider-a', 5000, 50_000), allocation('provider-b', 5000, 50_000)];
    const payouts = computeClaimPayouts(money(1, 'USD'), allocations); // a 1-cent loss, deliberately awkward
    expect(payouts.reduce((acc, p) => acc + p.amount.amountMinor, 0)).toBe(1);
  });

  it('refuses to compute payouts with no bound allocations at all', () => {
    expect(() => computeClaimPayouts(money(100, 'USD'), [])).toThrow(DomainError);
  });
});

describe('claim state machine', () => {
  it('only allows forward transitions', () => {
    expect(canTransitionClaim('REPORTED', 'EVIDENCE_COLLECTED')).toBe(true);
    expect(canTransitionClaim('EVIDENCE_COLLECTED', 'REPORTED')).toBe(false);
    expect(canTransitionClaim('REPORTED', 'APPROVED')).toBe(false);
  });

  it('allows LOSS_CALCULATED to go directly to APPROVED (the AUTO path)', () => {
    expect(canTransitionClaim('LOSS_CALCULATED', 'APPROVED')).toBe(true);
  });

  it('allows LOSS_CALCULATED to go to AWAITING_APPROVAL (the HUMAN_REVIEW path)', () => {
    expect(canTransitionClaim('LOSS_CALCULATED', 'AWAITING_APPROVAL')).toBe(true);
  });

  it('REJECTED and SETTLED are terminal', () => {
    expect(canTransitionClaim('REJECTED', 'APPROVED')).toBe(false);
    expect(canTransitionClaim('SETTLED', 'APPROVED')).toBe(false);
  });

  it('throws a domain error on an illegal transition', () => {
    expect(() => requireClaimTransition('SETTLED', 'REPORTED')).toThrow(DomainError);
  });
});
