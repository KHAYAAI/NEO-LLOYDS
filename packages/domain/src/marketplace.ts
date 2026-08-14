import { DomainError } from './errors.js';
import type { Money } from './money.js';
import { compareMoney } from './money.js';

/**
 * Marketplace matching (brief §8). Pure functions only: listing/appetite
 * persistence and the interest workflow live in the API layer, same split as
 * every other phase. This module answers one question — "is this capital
 * provider's declared appetite compatible with this listing?" — deterministically,
 * so a match or non-match is always explainable and reproducible.
 */

export type RiskTolerance = 'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE';

export interface Listing {
  readonly id: string;
  readonly riskClass: string;
  readonly jurisdiction: string;
  readonly capacity: Money;
  readonly durationDays: number;
}

/** A capital provider's standing appetite (brief §8). */
export interface CapitalAppetite {
  readonly organisationId: string;
  readonly preferredRiskClasses: readonly string[];
  readonly maxExposure: Money;
  readonly preferredJurisdictions: readonly string[];
  /** Minimum acceptable return, in basis points. */
  readonly minimumReturnBps: number;
  readonly maxDurationDays: number;
  readonly riskTolerance: RiskTolerance;
  /** Max share of the provider's total capacity any single listing may consume, in basis points. */
  readonly concentrationLimitBps: number;
}

export interface MatchResult {
  readonly matches: boolean;
  /** Every reason the listing was rejected; empty when matches is true. */
  readonly reasons: readonly string[];
}

/**
 * Deterministic compatibility check. Every rejection reason is explicit and
 * listed — there is no "no" without a stated cause, which is what makes this
 * auditable and disputable rather than a black box (ADR-0006's spirit
 * extended to matching, not just AI).
 */
export function matchesAppetite(listing: Listing, appetite: CapitalAppetite): MatchResult {
  if (listing.capacity.currency !== appetite.maxExposure.currency) {
    throw new DomainError(
      'Listing and appetite must share a currency; convert before matching',
      'CURRENCY_MISMATCH',
      { listingCurrency: listing.capacity.currency, appetiteCurrency: appetite.maxExposure.currency },
    );
  }

  const reasons: string[] = [];

  if (
    appetite.preferredRiskClasses.length > 0 &&
    !appetite.preferredRiskClasses.includes(listing.riskClass)
  ) {
    reasons.push(
      `Risk class ${listing.riskClass} is not in the provider's preferred classes (${appetite.preferredRiskClasses.join(', ')}).`,
    );
  }

  if (
    appetite.preferredJurisdictions.length > 0 &&
    !appetite.preferredJurisdictions.includes(listing.jurisdiction)
  ) {
    reasons.push(
      `Jurisdiction ${listing.jurisdiction} is not in the provider's preferred jurisdictions.`,
    );
  }

  if (compareMoney(listing.capacity, appetite.maxExposure) > 0) {
    reasons.push('Listing capacity exceeds the provider\'s maximum single exposure.');
  }

  if (listing.durationDays > appetite.maxDurationDays) {
    reasons.push(
      `Duration ${listing.durationDays}d exceeds the provider's maximum of ${appetite.maxDurationDays}d.`,
    );
  }

  // Concentration limit is expressed against the provider's own max exposure,
  // not the listing's capacity in isolation — it answers "would taking this
  // whole listing alone breach my per-position concentration limit?"
  const concentrationShareBps =
    appetite.maxExposure.amountMinor === 0
      ? 0
      : (listing.capacity.amountMinor / appetite.maxExposure.amountMinor) * 10_000;
  if (concentrationShareBps > appetite.concentrationLimitBps) {
    reasons.push(
      `Listing would consume ${(concentrationShareBps / 100).toFixed(1)}% of declared capacity, exceeding the ${(appetite.concentrationLimitBps / 100).toFixed(1)}% concentration limit.`,
    );
  }

  return Object.freeze({ matches: reasons.length === 0, reasons: Object.freeze(reasons) });
}

/** Ranks a set of listings for a provider: matches first, then by capacity descending. */
export function rankListings(
  listings: readonly Listing[],
  appetite: CapitalAppetite,
): readonly { listing: Listing; result: MatchResult }[] {
  return listings
    .map((listing) => ({ listing, result: matchesAppetite(listing, appetite) }))
    .sort((a, b) => {
      if (a.result.matches !== b.result.matches) return a.result.matches ? -1 : 1;
      return compareMoney(b.listing.capacity, a.listing.capacity);
    });
}
