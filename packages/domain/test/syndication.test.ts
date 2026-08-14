import { describe, expect, it } from 'vitest';
import {
  bindAllocations,
  DomainError,
  FULL_ALLOCATION_BPS,
  money,
  proposeAllocation,
  removeAllocation,
  requireFullyAllocated,
  totalShareBps,
  type Allocation,
} from '../src/index.js';

const capacity = money(100_000_000, 'USD'); // $1,000,000.00

describe('proposeAllocation: pre-binding invariants', () => {
  it('accumulates proposals up to but not exceeding 100%', () => {
    let allocations: readonly Allocation[] = [];
    allocations = proposeAllocation(allocations, { organisationId: 'a', shareBps: 2000 }, capacity);
    allocations = proposeAllocation(allocations, { organisationId: 'b', shareBps: 2500 }, capacity);
    allocations = proposeAllocation(allocations, { organisationId: 'c', shareBps: 1500 }, capacity);
    allocations = proposeAllocation(allocations, { organisationId: 'd', shareBps: 4000 }, capacity);
    expect(totalShareBps(allocations)).toBe(FULL_ALLOCATION_BPS);
  });

  it('rejects over-allocation: a proposal that would push the total past 100%', () => {
    let allocations: readonly Allocation[] = [];
    allocations = proposeAllocation(allocations, { organisationId: 'a', shareBps: 6000 }, capacity);
    expect(() =>
      proposeAllocation(allocations, { organisationId: 'b', shareBps: 5000 }, capacity),
    ).toThrow(DomainError);
    try {
      proposeAllocation(allocations, { organisationId: 'b', shareBps: 5000 }, capacity);
    } catch (error) {
      expect((error as DomainError).code).toBe('OVER_ALLOCATION');
    }
  });

  it('rejects duplicate capacity: the same organisation proposing twice', () => {
    let allocations: readonly Allocation[] = [];
    allocations = proposeAllocation(allocations, { organisationId: 'a', shareBps: 2000 }, capacity);
    expect(() =>
      proposeAllocation(allocations, { organisationId: 'a', shareBps: 1000 }, capacity),
    ).toThrow(DomainError);
    try {
      proposeAllocation(allocations, { organisationId: 'a', shareBps: 1000 }, capacity);
    } catch (error) {
      expect((error as DomainError).code).toBe('DUPLICATE_ALLOCATION');
    }
  });

  it('rejects a share of zero or below, and above 100%', () => {
    expect(() => proposeAllocation([], { organisationId: 'a', shareBps: 0 }, capacity)).toThrow(
      DomainError,
    );
    expect(() =>
      proposeAllocation([], { organisationId: 'a', shareBps: 10_001 }, capacity),
    ).toThrow(DomainError);
  });

  it('rejects an allocation exceeding the provider\'s declared maximum exposure', () => {
    const smallLimit = money(10_000_00, 'USD'); // $10,000 max exposure
    expect(() =>
      proposeAllocation([], { organisationId: 'a', shareBps: 5000 }, capacity, smallLimit),
    ).toThrow(DomainError);
    try {
      proposeAllocation([], { organisationId: 'a', shareBps: 5000 }, capacity, smallLimit);
    } catch (error) {
      expect((error as DomainError).code).toBe('EXPOSURE_LIMIT_EXCEEDED');
    }
  });

  it('allows an allocation within the exposure limit', () => {
    const generousLimit = money(1_000_000_00, 'USD');
    expect(() =>
      proposeAllocation([], { organisationId: 'a', shareBps: 5000 }, capacity, generousLimit),
    ).not.toThrow();
  });
});

describe('removeAllocation: still pre-binding, freely withdrawable', () => {
  it('removes a proposal, freeing its share', () => {
    let allocations: readonly Allocation[] = [];
    allocations = proposeAllocation(allocations, { organisationId: 'a', shareBps: 5000 }, capacity);
    allocations = removeAllocation(allocations, 'a');
    expect(totalShareBps(allocations)).toBe(0);
    // The freed share can now be reproposed without a duplicate error.
    expect(() =>
      proposeAllocation(allocations, { organisationId: 'a', shareBps: 5000 }, capacity),
    ).not.toThrow();
  });

  it('throws if there is nothing to remove', () => {
    expect(() => removeAllocation([], 'ghost')).toThrow(DomainError);
  });
});

describe('requireFullyAllocated: the gate before binding', () => {
  it('rejects an incomplete syndication', () => {
    const allocations = proposeAllocation([], { organisationId: 'a', shareBps: 5000 }, capacity);
    expect(() => requireFullyAllocated(allocations)).toThrow(DomainError);
  });

  it('accepts exactly 100%, no more, no less', () => {
    const allocations = proposeAllocation([], { organisationId: 'a', shareBps: 10_000 }, capacity);
    expect(() => requireFullyAllocated(allocations)).not.toThrow();
  });
});

describe('bindAllocations: the binding boundary', () => {
  it('refuses to bind an incomplete set', () => {
    const allocations = proposeAllocation([], { organisationId: 'a', shareBps: 9999 }, capacity);
    expect(() => bindAllocations(allocations, capacity)).toThrow(DomainError);
  });

  it('produces amounts that sum to capacity exactly, with no minor unit lost or invented', () => {
    let allocations: readonly Allocation[] = [];
    // Deliberately awkward shares that would leave a remainder under naive rounding.
    allocations = proposeAllocation(allocations, { organisationId: 'a', shareBps: 3333 }, capacity);
    allocations = proposeAllocation(allocations, { organisationId: 'b', shareBps: 3333 }, capacity);
    allocations = proposeAllocation(allocations, { organisationId: 'c', shareBps: 3334 }, capacity);

    const bound = bindAllocations(allocations, capacity);
    const sum = bound.reduce((acc, a) => acc + a.amount.amountMinor, 0);
    expect(sum).toBe(capacity.amountMinor);
  });

  it('is deterministic: binding the same proposals twice yields identical amounts', () => {
    const allocations = proposeAllocation([], { organisationId: 'a', shareBps: 6667 }, capacity);
    const withB = proposeAllocation(allocations, { organisationId: 'b', shareBps: 3333 }, capacity);
    expect(bindAllocations(withB, capacity)).toEqual(bindAllocations(withB, capacity));
  });

  it('does not merely trust indicative amounts: recomputes exactly even if scaleMoney would have rounded differently', () => {
    // 1 cent of capacity split three ways: scaleMoney per-share would each
    // round to 0, but the exact split must still sum to the whole cent.
    const tiny = money(1, 'USD');
    let allocations: readonly Allocation[] = [];
    allocations = proposeAllocation(allocations, { organisationId: 'a', shareBps: 3334 }, tiny);
    allocations = proposeAllocation(allocations, { organisationId: 'b', shareBps: 3333 }, tiny);
    allocations = proposeAllocation(allocations, { organisationId: 'c', shareBps: 3333 }, tiny);

    const bound = bindAllocations(allocations, tiny);
    expect(bound.reduce((acc, a) => acc + a.amount.amountMinor, 0)).toBe(1);
  });
});
