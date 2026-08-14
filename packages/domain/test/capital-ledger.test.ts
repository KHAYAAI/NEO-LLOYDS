import { describe, expect, it } from 'vitest';
import {
  computePosition,
  concentrationBy,
  DomainError,
  money,
  requireCapacityForProposal,
  type AllocationContribution,
  type CapitalCommitment,
} from '../src/index.js';

function commitment(amountMinor: number, currency = 'USD'): CapitalCommitment {
  return {
    organisationId: 'provider-1',
    committed: money(amountMinor, currency),
    updatedAt: '2026-08-14T00:00:00Z',
  };
}

function contribution(overrides: Partial<AllocationContribution> = {}): AllocationContribution {
  return {
    syndicationId: 'synd-1',
    status: 'BOUND',
    listingId: 'listing-1',
    riskClass: 'MARINE_CARGO',
    jurisdiction: 'ZA',
    counterpartyOrganisationId: 'originator-1',
    amount: money(10_000, 'USD'),
    ...overrides,
  };
}

describe('computePosition', () => {
  it('sums BOUND contributions as allocated and OPEN as reserved, ignoring CANCELLED', () => {
    const position = computePosition(commitment(100_000), [
      contribution({ status: 'BOUND', amount: money(30_000, 'USD') }),
      contribution({ status: 'OPEN', amount: money(20_000, 'USD') }),
      contribution({ status: 'CANCELLED', amount: money(50_000, 'USD') }),
    ]);
    expect(position.allocated.amountMinor).toBe(30_000);
    expect(position.reserved.amountMinor).toBe(20_000);
    expect(position.available.amountMinor).toBe(50_000);
  });

  it('never reports available as negative, even when overcommitted', () => {
    const position = computePosition(commitment(10_000), [
      contribution({ status: 'BOUND', amount: money(15_000, 'USD') }),
    ]);
    expect(position.available.amountMinor).toBe(0);
    // But the overcommitment is still visible, not hidden by clamping.
    expect(position.utilisationBps).toBeGreaterThan(10_000);
  });

  it('reports zero utilisation for zero committed capital, not a division error', () => {
    const position = computePosition(commitment(0), []);
    expect(position.utilisationBps).toBe(0);
  });

  it('sums contributions across multiple distinct syndications, not just one', () => {
    const position = computePosition(commitment(100_000), [
      contribution({ syndicationId: 'synd-a', status: 'BOUND', amount: money(20_000, 'USD') }),
      contribution({ syndicationId: 'synd-b', status: 'BOUND', amount: money(25_000, 'USD') }),
      contribution({ syndicationId: 'synd-c', status: 'OPEN', amount: money(10_000, 'USD') }),
    ]);
    expect(position.allocated.amountMinor).toBe(45_000);
    expect(position.reserved.amountMinor).toBe(10_000);
    expect(position.available.amountMinor).toBe(45_000);
  });

  it('rejects a contribution in a different currency than the commitment', () => {
    expect(() =>
      computePosition(commitment(100_000, 'USD'), [contribution({ amount: money(1, 'ZAR') })]),
    ).toThrow(DomainError);
  });
});

describe('requireCapacityForProposal: the cross-syndication enforcement point', () => {
  it('allows a proposal within available capacity', () => {
    const position = computePosition(commitment(100_000), [
      contribution({ syndicationId: 'synd-a', amount: money(40_000, 'USD') }),
    ]);
    expect(() => requireCapacityForProposal(position, money(50_000, 'USD'))).not.toThrow();
  });

  it('rejects a proposal that would exceed capacity already consumed by OTHER syndications', () => {
    // The provider has $90,000 of its $100,000 committed capital already
    // tied up across two other syndications — neither of which the caller
    // proposing a third would see if capacity were checked per-listing only.
    const position = computePosition(commitment(100_000), [
      contribution({ syndicationId: 'synd-a', status: 'BOUND', amount: money(60_000, 'USD') }),
      contribution({ syndicationId: 'synd-b', status: 'OPEN', amount: money(30_000, 'USD') }),
    ]);
    expect(() => requireCapacityForProposal(position, money(20_000, 'USD'))).toThrow(DomainError);
    try {
      requireCapacityForProposal(position, money(20_000, 'USD'));
    } catch (error) {
      expect((error as DomainError).code).toBe('INSUFFICIENT_COMMITTED_CAPITAL');
      expect((error as DomainError).details['available']).toEqual(money(10_000, 'USD'));
    }
  });

  it('allows a proposal that exactly exhausts remaining capacity', () => {
    const position = computePosition(commitment(100_000), [
      contribution({ amount: money(60_000, 'USD') }),
    ]);
    expect(() => requireCapacityForProposal(position, money(40_000, 'USD'))).not.toThrow();
  });

  it('rejects a proposal against a provider with no remaining capacity at all', () => {
    const position = computePosition(commitment(50_000), [
      contribution({ amount: money(50_000, 'USD') }),
    ]);
    expect(() => requireCapacityForProposal(position, money(1, 'USD'))).toThrow(DomainError);
  });
});

describe('concentrationBy', () => {
  it('groups exposure by an arbitrary key and reports share of total exposure', () => {
    const buckets = concentrationBy(
      [
        contribution({ riskClass: 'MARINE_CARGO', amount: money(30_000, 'USD') }),
        contribution({ riskClass: 'MARINE_CARGO', amount: money(20_000, 'USD') }),
        contribution({ riskClass: 'CYBER', amount: money(50_000, 'USD') }),
      ],
      (c) => c.riskClass,
      'USD',
    );
    // Equal amounts: order is a stable tie-break (insertion order), not
    // significant to the invariant being tested — assert the set, not order.
    expect(buckets).toHaveLength(2);
    expect(buckets.every((b) => b.shareBps === 5000)).toBe(true);
    expect(new Set(buckets.map((b) => b.key))).toEqual(new Set(['CYBER', 'MARINE_CARGO']));
  });

  it('excludes CANCELLED contributions from concentration entirely', () => {
    const buckets = concentrationBy(
      [
        contribution({ riskClass: 'MARINE_CARGO', status: 'BOUND', amount: money(10_000, 'USD') }),
        contribution({ riskClass: 'CYBER', status: 'CANCELLED', amount: money(90_000, 'USD') }),
      ],
      (c) => c.riskClass,
      'USD',
    );
    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.shareBps).toBe(10_000);
  });

  it('returns an empty list rather than dividing by zero when there is no exposure', () => {
    expect(concentrationBy([], (c) => c.riskClass, 'USD')).toEqual([]);
  });

  it('can group by counterparty to reveal concentration in a single originator', () => {
    const buckets = concentrationBy(
      [
        contribution({ counterpartyOrganisationId: 'org-a', amount: money(80_000, 'USD') }),
        contribution({ counterpartyOrganisationId: 'org-b', amount: money(20_000, 'USD') }),
      ],
      (c) => c.counterpartyOrganisationId,
      'USD',
    );
    expect(buckets[0]).toEqual({ key: 'org-a', amount: money(80_000, 'USD'), shareBps: 8000 });
  });
});
