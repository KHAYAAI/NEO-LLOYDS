import { DomainError } from './errors.js';
import { allocateMoney, compareMoney, scaleMoney, type Money } from './money.js';

/**
 * Syndication (brief §9). This is the first module in the system where a
 * capital provider's participation stops being a statement of interest and
 * becomes a binding commitment. That crossing happens at exactly one
 * function: {@link bindAllocations}. Every other function here operates on
 * *proposed* allocations, which remain freely add/removable — nothing before
 * `bindAllocations` obligates anyone to anything (docs/reports/phase-5.md
 * marks this boundary explicitly, in both directions: what is still
 * withdrawable, and what, once bound, is not).
 */

/** Basis points: 10_000 = 100%. Exactness is expressed in integers, never floats. */
export const FULL_ALLOCATION_BPS = 10_000;

export interface AllocationProposal {
  readonly organisationId: string;
  readonly shareBps: number;
}

/** A proposal plus its indicative amount. Indicative until bound — see below. */
export interface Allocation extends AllocationProposal {
  readonly amount: Money;
}

function assertValidShare(shareBps: number): void {
  if (!Number.isInteger(shareBps) || shareBps <= 0 || shareBps > FULL_ALLOCATION_BPS) {
    throw new DomainError(
      'shareBps must be an integer in (0, 10000]',
      'INVALID_SHARE',
      { shareBps },
    );
  }
}

export function totalShareBps(allocations: readonly AllocationProposal[]): number {
  return allocations.reduce((sum, a) => sum + a.shareBps, 0);
}

/**
 * Adds a proposed allocation. This is pre-binding: the result is still just a
 * list of proposals, and every invariant enforced here (no duplicate
 * capacity, no over-allocation, no exposure-limit breach) is checked against
 * the *proposed* total, not a bound one. Nothing this function returns has
 * committed anyone's capital.
 */
export function proposeAllocation(
  current: readonly Allocation[],
  proposal: AllocationProposal,
  capacity: Money,
  providerMaxExposure?: Money,
): readonly Allocation[] {
  assertValidShare(proposal.shareBps);

  if (current.some((a) => a.organisationId === proposal.organisationId)) {
    throw new DomainError(
      'This organisation already has a proposed allocation on this syndication',
      'DUPLICATE_ALLOCATION',
      { organisationId: proposal.organisationId },
    );
  }

  const prospectiveTotal = totalShareBps(current) + proposal.shareBps;
  if (prospectiveTotal > FULL_ALLOCATION_BPS) {
    throw new DomainError(
      `Proposed allocation would bring total to ${prospectiveTotal / 100}%, exceeding 100%`,
      'OVER_ALLOCATION',
      { prospectiveTotalBps: prospectiveTotal, remainingBps: FULL_ALLOCATION_BPS - totalShareBps(current) },
    );
  }

  const amount = scaleMoney(capacity, proposal.shareBps / FULL_ALLOCATION_BPS);

  if (providerMaxExposure && compareMoney(amount, providerMaxExposure) > 0) {
    throw new DomainError(
      "Proposed allocation exceeds the provider's declared maximum exposure",
      'EXPOSURE_LIMIT_EXCEEDED',
      { amount, providerMaxExposure },
    );
  }

  return [...current, { ...proposal, amount }];
}

export function removeAllocation(
  current: readonly Allocation[],
  organisationId: string,
): readonly Allocation[] {
  if (!current.some((a) => a.organisationId === organisationId)) {
    throw new DomainError('No proposed allocation exists for this organisation', 'ALLOCATION_NOT_FOUND', {
      organisationId,
    });
  }
  return current.filter((a) => a.organisationId !== organisationId);
}

export function requireFullyAllocated(current: readonly Allocation[]): void {
  const total = totalShareBps(current);
  if (total !== FULL_ALLOCATION_BPS) {
    throw new DomainError(
      `Allocations total ${total / 100}%, not 100%. Cannot bind an incomplete syndication.`,
      'INCOMPLETE_ALLOCATION',
      { totalBps: total, remainingBps: FULL_ALLOCATION_BPS - total },
    );
  }
}

/**
 * THE BINDING BOUNDARY.
 *
 * Everything before this function operates on proposals: freely proposed,
 * freely withdrawn, enforced only against a *prospective* 100% ceiling. This
 * function is the one and only place a set of proposals becomes a
 * commitment — and it only accepts a set that already sums to exactly 100%
 * (`requireFullyAllocated`, checked first). It recomputes exact amounts with
 * {@link allocateMoney} rather than trusting the indicative `scaleMoney`
 * figures accumulated during proposal, because allocateMoney is the only
 * money split in this codebase guaranteed to sum to the total exactly, with
 * no minor unit lost or invented (ADR-0005) — and a binding allocation must
 * be exact, not merely close.
 *
 * This function has no side effects and touches no storage: it is pure, so
 * the moment of binding is reproducible and independently verifiable. The
 * API layer (`SyndicationService.bind`) is what actually persists the result
 * as immutable — that persistence step, not this computation, is where the
 * system stops being able to change its mind.
 */
export function bindAllocations(
  proposals: readonly Allocation[],
  capacity: Money,
): readonly Allocation[] {
  requireFullyAllocated(proposals);

  const exactAmounts = allocateMoney(
    capacity,
    proposals.map((p) => p.shareBps),
  );

  return proposals.map((proposal, index) => ({
    ...proposal,
    amount: exactAmounts[index] as Money,
  }));
}
