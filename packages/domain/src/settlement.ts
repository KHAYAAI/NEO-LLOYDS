import { DomainError } from './errors.js';
import { addMoney, money, subtractMoney, type Money } from './money.js';

/**
 * Settlement (roadmap Phase 10). This is where Phase 7's claims "settled"
 * status — a bare state-machine flag, no money moving — gets real
 * transaction infrastructure behind it: a `SettlementProvider` abstraction
 * over bank / digital-money / stablecoin rails, a fee engine, and a full
 * transaction record. No cryptocurrency is hard-coded: `STABLECOIN` is a
 * settlement *method* a future provider could implement, not an
 * implementation of any specific chain or token here.
 *
 * The domain layer's job, as in every other phase, is the math and the
 * state machine — not moving money itself. That is the API layer's
 * `SettlementProvider` port (`apps/api/src/settlement`), which this phase
 * ships with exactly one honest implementation: a `NullSettlementProvider`
 * that records everything precisely and moves nothing, because no real
 * bank/stablecoin integration exists yet. See docs/reports/phase-10.md.
 */

export const SETTLEMENT_METHODS = ['BANK_TRANSFER', 'DIGITAL_MONEY', 'STABLECOIN'] as const;
export type SettlementMethod = (typeof SETTLEMENT_METHODS)[number];

export function isSettlementMethod(value: string): value is SettlementMethod {
  return (SETTLEMENT_METHODS as readonly string[]).includes(value);
}

export const SETTLEMENT_STATUSES = ['PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED'] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

const SETTLEMENT_TRANSITIONS: Readonly<Record<SettlementStatus, readonly SettlementStatus[]>> = Object.freeze({
  PENDING: ['SUBMITTED', 'FAILED'],
  SUBMITTED: ['CONFIRMED', 'FAILED'],
  CONFIRMED: [],
  FAILED: [],
});

export function canTransitionSettlement(from: SettlementStatus, to: SettlementStatus): boolean {
  return SETTLEMENT_TRANSITIONS[from].includes(to);
}

export function requireSettlementTransition(from: SettlementStatus, to: SettlementStatus): void {
  if (!canTransitionSettlement(from, to)) {
    throw new DomainError(`A settlement transaction cannot move from ${from} to ${to}`, 'INVALID_SETTLEMENT_TRANSITION', {
      from,
      to,
    });
  }
}

/**
 * A flat fee plus a proportional fee, applied together — the same
 * "configurable, illustrative, not calibrated against real rail costs"
 * caveat as every threshold in this system (Phase 3's approval bands, Phase
 * 7's auto-approval ceiling): a defensible starting shape, not a real
 * pricing schedule from an actual settlement provider.
 */
export interface SettlementFeeConfig {
  readonly flatMinor: number;
  readonly bps: number;
}

export function requireValidFeeConfig(config: SettlementFeeConfig): void {
  if (!Number.isInteger(config.flatMinor) || config.flatMinor < 0) {
    throw new DomainError('flatMinor must be a non-negative integer', 'INVALID_FEE_CONFIG', {
      flatMinor: config.flatMinor,
    });
  }
  if (!Number.isInteger(config.bps) || config.bps < 0 || config.bps > 10_000) {
    throw new DomainError('bps must be an integer in [0, 10000]', 'INVALID_FEE_CONFIG', {
      bps: config.bps,
    });
  }
}

/** Computes the fee for a gross amount. Never larger than the gross amount itself. */
export function computeSettlementFee(grossAmount: Money, config: SettlementFeeConfig): Money {
  requireValidFeeConfig(config);
  const proportional = Math.round((grossAmount.amountMinor * config.bps) / 10_000);
  const fee = Math.min(config.flatMinor + proportional, grossAmount.amountMinor);
  return money(fee, grossAmount.currency);
}

export interface SettlementCalculation {
  readonly grossAmount: Money;
  readonly fee: Money;
  readonly netAmount: Money;
}

/** The net amount that actually reaches the payee, after the fee — grossAmount = fee + netAmount, exactly. */
export function calculateSettlement(grossAmount: Money, config: SettlementFeeConfig): SettlementCalculation {
  const fee = computeSettlementFee(grossAmount, config);
  return { grossAmount, fee, netAmount: subtractMoney(grossAmount, fee) };
}

/** Sanity check used by tests and callers who want to assert the split never loses or invents a minor unit. */
export function settlementSplitIsExact(calc: SettlementCalculation): boolean {
  return addMoney(calc.fee, calc.netAmount).amountMinor === calc.grossAmount.amountMinor;
}
