import { describe, expect, it } from 'vitest';
import { DomainError, matchesAppetite, money, rankListings, type CapitalAppetite, type Listing } from '../src/index.js';

function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: 'listing-1',
    riskClass: 'MARINE_CARGO',
    jurisdiction: 'ZA',
    capacity: money(1_000_000_00, 'USD'),
    durationDays: 30,
    ...overrides,
  };
}

function appetite(overrides: Partial<CapitalAppetite> = {}): CapitalAppetite {
  return {
    organisationId: 'provider-1',
    preferredRiskClasses: ['MARINE_CARGO'],
    maxExposure: money(5_000_000_00, 'USD'),
    preferredJurisdictions: ['ZA'],
    minimumReturnBps: 500,
    maxDurationDays: 60,
    riskTolerance: 'MODERATE',
    concentrationLimitBps: 5000, // 50%
    ...overrides,
  };
}

describe('marketplace matching', () => {
  it('matches when every criterion is satisfied', () => {
    const result = matchesAppetite(listing(), appetite());
    expect(result.matches).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it('rejects an unlisted risk class with an explicit reason', () => {
    const result = matchesAppetite(listing({ riskClass: 'CYBER' }), appetite());
    expect(result.matches).toBe(false);
    expect(result.reasons[0]).toContain('CYBER');
  });

  it('rejects an unlisted jurisdiction', () => {
    const result = matchesAppetite(listing({ jurisdiction: 'KE' }), appetite());
    expect(result.matches).toBe(false);
    expect(result.reasons.some((r) => r.includes('Jurisdiction'))).toBe(true);
  });

  it('rejects capacity exceeding the maximum exposure', () => {
    const result = matchesAppetite(
      listing({ capacity: money(10_000_000_00, 'USD') }),
      appetite(),
    );
    expect(result.matches).toBe(false);
    expect(result.reasons.some((r) => r.includes('exceeds'))).toBe(true);
  });

  it('rejects duration exceeding the maximum', () => {
    const result = matchesAppetite(listing({ durationDays: 90 }), appetite());
    expect(result.matches).toBe(false);
    expect(result.reasons.some((r) => r.includes('Duration'))).toBe(true);
  });

  it('rejects a listing that would breach the concentration limit', () => {
    const result = matchesAppetite(
      listing({ capacity: money(4_000_000_00, 'USD') }), // 80% of 5m max exposure
      appetite({ concentrationLimitBps: 5000 }), // 50% limit
    );
    expect(result.matches).toBe(false);
    expect(result.reasons.some((r) => r.includes('concentration'))).toBe(true);
  });

  it('an empty preferred-classes list means "no restriction", not "match nothing"', () => {
    const result = matchesAppetite(
      listing({ riskClass: 'ANYTHING' }),
      appetite({ preferredRiskClasses: [] }),
    );
    expect(result.matches).toBe(true);
  });

  it('rejects mismatched currencies rather than silently comparing them', () => {
    expect(() =>
      matchesAppetite(listing({ capacity: money(1_00, 'ZAR') }), appetite()),
    ).toThrow(DomainError);
  });

  it('ranks matches before non-matches, then by capacity descending', () => {
    const small = listing({ id: 'small', capacity: money(100_000_00, 'USD') });
    const large = listing({ id: 'large', capacity: money(2_000_000_00, 'USD') });
    const nonMatch = listing({ id: 'non-match', riskClass: 'CYBER' });

    const ranked = rankListings([nonMatch, small, large], appetite());
    expect(ranked.map((r) => r.listing.id)).toEqual(['large', 'small', 'non-match']);
  });
});
