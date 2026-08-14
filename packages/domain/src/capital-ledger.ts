import { DomainError } from './errors.js';
import { addMoney, compareMoney, money, subtractMoney, type Money } from './money.js';

/**
 * Capital Ledger (brief §10). Phase 5 enforced that a single listing's
 * allocation could not exceed a provider's declared per-listing exposure
 * ceiling (its `CapitalAppetite.maxExposure`). That check is necessarily
 * local: it only ever sees one syndication at a time. This module is what
 * makes a provider's *total* exposure — summed across every syndication it
 * has proposed into or bound into, anywhere on the platform — a real,
 * computed, enforced quantity for the first time.
 */

/** A capital provider's declared ceiling: the most it will ever commit, platform-wide. */
export interface CapitalCommitment {
  readonly organisationId: string;
  readonly committed: Money;
  readonly updatedAt: string;
}

/** One allocation contributing to a provider's exposure, from any syndication. */
export interface AllocationContribution {
  readonly syndicationId: string;
  readonly status: 'OPEN' | 'BOUND' | 'CANCELLED';
  readonly listingId: string;
  readonly riskClass: string;
  readonly jurisdiction: string;
  /** The risk originator on the other side of this allocation. */
  readonly counterpartyOrganisationId: string;
  readonly amount: Money;
}

export interface CapitalPosition {
  readonly organisationId: string;
  readonly committed: Money;
  /** Sum of amounts from BOUND allocations: capital genuinely at risk right now. */
  readonly allocated: Money;
  /** Sum of amounts from OPEN (proposed, not yet bound) allocations: a soft hold. */
  readonly reserved: Money;
  /** committed - allocated - reserved. Never presented as negative; see below. */
  readonly available: Money;
  /** (allocated + reserved) / committed, in basis points. 0 if committed is 0. */
  readonly utilisationBps: number;
}

function assertSameCurrency(a: Money, b: Money, context: string): void {
  if (a.currency !== b.currency) {
    throw new DomainError(
      `Cannot combine ${context} of different currencies without an explicit FX rate`,
      'CURRENCY_MISMATCH',
      { left: a.currency, right: b.currency, context },
    );
  }
}

/**
 * Computes a provider's current position from its commitment and every
 * contribution it has anywhere on the platform. Pure and total: it never
 * throws for an already-overcommitted position (that would make it
 * impossible to *observe* an overcommitment, which is the opposite of what
 * a ledger is for) — `available` is simply reported as zero rather than
 * negative, and `utilisationBps` can exceed 10_000 to make an
 * overcommitment visible rather than hidden by clamping.
 */
export function computePosition(
  commitment: CapitalCommitment,
  contributions: readonly AllocationContribution[],
): CapitalPosition {
  const currency = commitment.committed.currency;

  let allocated = money(0, currency);
  let reserved = money(0, currency);

  for (const contribution of contributions) {
    assertSameCurrency(commitment.committed, contribution.amount, 'ledger contributions');
    if (contribution.status === 'BOUND') {
      allocated = addMoney(allocated, contribution.amount);
    } else if (contribution.status === 'OPEN') {
      reserved = addMoney(reserved, contribution.amount);
    }
    // CANCELLED contributes nothing — it never became exposure.
  }

  const committed = commitment.committed;
  const used = addMoney(allocated, reserved);
  const available =
    compareMoney(used, committed) >= 0 ? money(0, currency) : subtractMoney(committed, used);

  const utilisationBps =
    committed.amountMinor === 0 ? 0 : Math.round((used.amountMinor / committed.amountMinor) * 10_000);

  return Object.freeze({
    organisationId: commitment.organisationId,
    committed,
    allocated,
    reserved,
    available,
    utilisationBps,
  });
}

/**
 * THE cross-syndication enforcement point. A single listing's exposure limit
 * (Phase 5, checked against `CapitalAppetite.maxExposure`) is necessarily
 * blind to what else a provider has committed elsewhere. This function is
 * what a provider's *total* platform-wide exposure is checked against before
 * any new proposal is allowed to add to it.
 */
export function requireCapacityForProposal(position: CapitalPosition, proposedAmount: Money): void {
  assertSameCurrency(position.available, proposedAmount, 'a proposed allocation and available capacity');
  if (compareMoney(proposedAmount, position.available) > 0) {
    throw new DomainError(
      "Proposed allocation exceeds the provider's available committed capital across all syndications",
      'INSUFFICIENT_COMMITTED_CAPITAL',
      {
        proposedAmount,
        available: position.available,
        committed: position.committed,
        allocated: position.allocated,
        reserved: position.reserved,
      },
    );
  }
}

export interface ConcentrationBucket {
  readonly key: string;
  readonly amount: Money;
  /** Share of the provider's total exposure (allocated + reserved) this bucket represents. */
  readonly shareBps: number;
}

/**
 * Groups a provider's contributions by an arbitrary key (risk class,
 * jurisdiction, counterparty, ...) and reports each bucket's share of total
 * exposure. Concentration by industry, event and asset are not computable
 * yet: the risk graph does not carry those attributes as structured fields
 * on a listing (docs/reports/phase-6.md records this as a real gap, not an
 * oversight — it is bounded by what Phase 1's ontology currently models,
 * not by anything in this function).
 */
export function concentrationBy(
  contributions: readonly AllocationContribution[],
  keyOf: (c: AllocationContribution) => string,
  currency: string,
): readonly ConcentrationBucket[] {
  const exposed = contributions.filter((c) => c.status === 'BOUND' || c.status === 'OPEN');
  if (exposed.length === 0) return [];

  const totals = new Map<string, Money>();
  for (const contribution of exposed) {
    assertSameCurrency(money(0, currency), contribution.amount, 'concentration contributions');
    const key = keyOf(contribution);
    totals.set(key, addMoney(totals.get(key) ?? money(0, currency), contribution.amount));
  }

  const grandTotal = [...totals.values()].reduce((acc, m) => addMoney(acc, m), money(0, currency));

  return [...totals.entries()]
    .map(([key, amount]) => ({
      key,
      amount,
      shareBps:
        grandTotal.amountMinor === 0
          ? 0
          : Math.round((amount.amountMinor / grandTotal.amountMinor) * 10_000),
    }))
    .sort((a, b) => b.amount.amountMinor - a.amount.amountMinor);
}
