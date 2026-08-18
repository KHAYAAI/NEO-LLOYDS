import { describe, expect, it } from 'vitest';
import {
  calculateSettlement,
  canTransitionSettlement,
  computeSettlementFee,
  DomainError,
  money,
  requireSettlementTransition,
  requireValidFeeConfig,
  settlementSplitIsExact,
} from '../src/index.js';

describe('computeSettlementFee', () => {
  it('combines a flat fee and a proportional fee', () => {
    const fee = computeSettlementFee(money(10_000_00, 'USD'), { flatMinor: 100, bps: 100 }); // 1%
    expect(fee).toEqual(money(100 + 10_000_00 * 0.01, 'USD'));
  });

  it('never exceeds the gross amount', () => {
    const fee = computeSettlementFee(money(50, 'USD'), { flatMinor: 1_000_00, bps: 500 });
    expect(fee).toEqual(money(50, 'USD'));
  });

  it('is zero when both fee components are zero', () => {
    const fee = computeSettlementFee(money(10_000_00, 'USD'), { flatMinor: 0, bps: 0 });
    expect(fee).toEqual(money(0, 'USD'));
  });
});

describe('calculateSettlement', () => {
  it('splits gross into fee and net with no minor unit lost or invented', () => {
    const calc = calculateSettlement(money(999_99, 'USD'), { flatMinor: 50, bps: 250 });
    expect(settlementSplitIsExact(calc)).toBe(true);
    expect(calc.fee.amountMinor + calc.netAmount.amountMinor).toBe(999_99);
  });

  it('net amount equals gross minus fee exactly', () => {
    const calc = calculateSettlement(money(10_000_00, 'USD'), { flatMinor: 200, bps: 50 });
    expect(calc.netAmount.amountMinor).toBe(calc.grossAmount.amountMinor - calc.fee.amountMinor);
  });
});

describe('requireValidFeeConfig', () => {
  it('rejects a negative flat fee', () => {
    expect(() => requireValidFeeConfig({ flatMinor: -1, bps: 0 })).toThrow(DomainError);
  });

  it('rejects bps outside [0, 10000]', () => {
    expect(() => requireValidFeeConfig({ flatMinor: 0, bps: -1 })).toThrow(DomainError);
    expect(() => requireValidFeeConfig({ flatMinor: 0, bps: 10_001 })).toThrow(DomainError);
  });

  it('accepts a well-formed config', () => {
    expect(() => requireValidFeeConfig({ flatMinor: 100, bps: 50 })).not.toThrow();
  });
});

describe('settlement transaction state machine', () => {
  it('allows PENDING -> SUBMITTED -> CONFIRMED', () => {
    expect(canTransitionSettlement('PENDING', 'SUBMITTED')).toBe(true);
    expect(canTransitionSettlement('SUBMITTED', 'CONFIRMED')).toBe(true);
  });

  it('allows failure from PENDING or SUBMITTED', () => {
    expect(canTransitionSettlement('PENDING', 'FAILED')).toBe(true);
    expect(canTransitionSettlement('SUBMITTED', 'FAILED')).toBe(true);
  });

  it('CONFIRMED and FAILED are terminal', () => {
    expect(canTransitionSettlement('CONFIRMED', 'SUBMITTED')).toBe(false);
    expect(canTransitionSettlement('FAILED', 'SUBMITTED')).toBe(false);
  });

  it('rejects skipping straight from PENDING to CONFIRMED', () => {
    expect(canTransitionSettlement('PENDING', 'CONFIRMED')).toBe(false);
    expect(() => requireSettlementTransition('PENDING', 'CONFIRMED')).toThrow(DomainError);
  });
});
