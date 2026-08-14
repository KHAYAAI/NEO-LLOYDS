import { DomainError } from './errors.js';
import type { Money } from './money.js';

/**
 * A confidence in [0,1]. Every quantitative output in Neo-Lloyds carries one:
 * the domain exposes no way to return a naked number (ADR-0005).
 */
export type Confidence = number;

export function confidence(value: number): Confidence {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new DomainError('Confidence must be a number in [0,1]', 'INVALID_CONFIDENCE', {
      value,
    });
  }
  return value;
}

/** Why we believe an estimate — never a bare assertion. */
export type EstimateBasis =
  | 'OBSERVED'
  | 'STATISTICAL_MODEL'
  | 'EXPERT_JUDGEMENT'
  | 'AI_INFERENCE'
  | 'INSUFFICIENT_DATA';

/** A point estimate with explicit uncertainty. */
export interface Estimate {
  readonly expected: number;
  readonly confidence: Confidence;
  readonly basis: EstimateBasis;
}

/** An estimate expressed as a range. Preferred wherever a range is defensible. */
export interface RangeEstimate {
  readonly low: number;
  readonly expected: number;
  readonly high: number;
  readonly confidence: Confidence;
  readonly basis: EstimateBasis;
}

/** A monetary estimate. Loss figures use this, never a bare {@link Money}. */
export interface MoneyEstimate {
  readonly low: Money;
  readonly expected: Money;
  readonly high: Money;
  readonly confidence: Confidence;
  readonly basis: EstimateBasis;
}

export function estimate(
  expected: number,
  conf: number,
  basis: EstimateBasis,
): Estimate {
  if (!Number.isFinite(expected)) {
    throw new DomainError('Estimate must be finite', 'INVALID_ESTIMATE', { expected });
  }
  return Object.freeze({ expected, confidence: confidence(conf), basis });
}

export function rangeEstimate(
  low: number,
  expected: number,
  high: number,
  conf: number,
  basis: EstimateBasis,
): RangeEstimate {
  if (![low, expected, high].every(Number.isFinite)) {
    throw new DomainError('Range bounds must be finite', 'INVALID_ESTIMATE', {
      low,
      expected,
      high,
    });
  }
  if (!(low <= expected && expected <= high)) {
    throw new DomainError(
      'Range estimate must satisfy low <= expected <= high',
      'INVALID_ESTIMATE',
      { low, expected, high },
    );
  }
  return Object.freeze({ low, expected, high, confidence: confidence(conf), basis });
}

/**
 * A probability with its confidence. Probability and confidence are distinct:
 * "a 12% chance, which we are 71% sure of" is not the same claim as "12%".
 */
export interface Probability {
  readonly value: number;
  readonly confidence: Confidence;
  readonly basis: EstimateBasis;
}

export function probability(
  value: number,
  conf: number,
  basis: EstimateBasis,
): Probability {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new DomainError('Probability must be in [0,1]', 'INVALID_PROBABILITY', {
      value,
    });
  }
  return Object.freeze({ value, confidence: confidence(conf), basis });
}

/**
 * Combining evidence never increases confidence beyond its weakest input.
 * This is deliberately conservative: an aggregate is only as trustworthy as
 * the least trustworthy thing it rests on.
 */
export function combineConfidence(values: readonly Confidence[]): Confidence {
  if (values.length === 0) return confidence(0);
  return confidence(Math.min(...values));
}

/**
 * Round a value to a number of significant figures justified by its confidence.
 * Low confidence must not be reported to six decimal places — false precision
 * is a correctness bug, not a formatting preference.
 */
export function significantDigitsFor(conf: Confidence): number {
  if (conf >= 0.9) return 3;
  if (conf >= 0.7) return 2;
  return 1;
}

export function presentValue(value: number, conf: Confidence): number {
  if (value === 0) return 0;
  const digits = significantDigitsFor(conf);
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const factor = 10 ** (digits - 1 - magnitude);
  return Math.round(value * factor) / factor;
}
