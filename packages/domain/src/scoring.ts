import { DomainError } from './errors.js';
import type { Money } from './money.js';
import { addMoney, money, scaleMoney } from './money.js';
import {
  combineConfidence,
  estimate,
  rangeEstimate,
  type Confidence,
  type Estimate,
  type EstimateBasis,
  type RangeEstimate,
} from './uncertainty.js';

/**
 * Deterministic risk scoring (Phase 2, brief §5).
 *
 * This module computes a score from declared inputs only — it does not
 * observe the world. Every output carries confidence and basis; there is no
 * function here that returns a bare number. "Deterministic" means the same
 * RiskFactors always produce the same RiskScore: reproducibility is the point
 * (ADR-0001), not an accident of implementation.
 */

/** A single contributor to a risk, declared by a broker/originator or derived. */
export interface RiskFactor {
  readonly key: string;
  readonly description: string;
  /** How strongly this factor drives probability, in [0,1]. */
  readonly weight: number;
  /** The factor's own likelihood, in [0,1]. */
  readonly likelihood: number;
  readonly confidence: Confidence;
  readonly basis: EstimateBasis;
}

export interface RiskFactorsInput {
  readonly riskId: string;
  readonly factors: readonly RiskFactor[];
  /** Maximum plausible loss if the risk fully materialises. */
  readonly maximumEstimatedLoss: Money;
  /** Expected duration of exposure, in days. */
  readonly durationDays: number;
  /** 0 (none) to 1 (fully mitigated) — controls, redundancy, prior mitigation. */
  readonly mitigationCoverage: number;
  /** Count of other risks this one is known to move together with. */
  readonly correlatedRiskCount: number;
  /** Share of total portfolio capacity this single risk would consume, in [0,1]. */
  readonly concentrationShare: number;
}

export interface RiskScore {
  readonly riskId: string;
  readonly probability: Estimate;
  readonly severity: RangeEstimate;
  readonly expectedLoss: { low: Money; expected: Money; high: Money };
  readonly maximumEstimatedLoss: Money;
  readonly confidence: Confidence;
  readonly durationDays: number;
  readonly correlationScore: Estimate;
  readonly concentrationScore: Estimate;
  readonly mitigationScore: Estimate;
  readonly computedAt: string;
  /** Bumped when the scoring formula changes, recorded on every audit record. */
  readonly modelVersion: string;
}

export const SCORING_MODEL_VERSION = 'deterministic-v1';

function assertUnitInterval(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new DomainError(`${field} must be in [0,1]`, 'INVALID_SCORING_INPUT', {
      field,
      value,
    });
  }
}

/**
 * Weighted-average probability from declared factors, discounted by
 * mitigation coverage. No factor, no probability: an empty factor list
 * produces INSUFFICIENT_DATA rather than a guessed number.
 */
function computeProbability(
  factors: readonly RiskFactor[],
  mitigationCoverage: number,
): Estimate {
  if (factors.length === 0) {
    return estimate(0, 0, 'INSUFFICIENT_DATA');
  }

  const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
  if (totalWeight <= 0) {
    throw new DomainError('At least one risk factor must carry positive weight', 'INVALID_SCORING_INPUT');
  }

  const weighted =
    factors.reduce((sum, f) => sum + f.weight * f.likelihood, 0) / totalWeight;
  const mitigated = weighted * (1 - mitigationCoverage);
  const confidence = combineConfidence(factors.map((f) => f.confidence));
  const basis: EstimateBasis = factors.every((f) => f.basis === 'OBSERVED')
    ? 'OBSERVED'
    : factors.some((f) => f.basis === 'AI_INFERENCE')
      ? 'AI_INFERENCE'
      : 'EXPERT_JUDGEMENT';

  return estimate(Math.min(1, Math.max(0, mitigated)), confidence, basis);
}

/** Severity as a fraction of MEL, widened as confidence falls. */
function computeSeverity(probability: Estimate): RangeEstimate {
  const spread = 0.5 * (1 - probability.confidence); // low confidence -> wider band
  const low = Math.max(0, probability.expected - spread);
  const high = Math.min(1, probability.expected + spread);
  return rangeEstimate(low, probability.expected, high, probability.confidence, probability.basis);
}

function computeExpectedLoss(
  severity: RangeEstimate,
  mel: Money,
): { low: Money; expected: Money; high: Money } {
  return {
    low: scaleMoney(mel, severity.low),
    expected: scaleMoney(mel, severity.expected),
    high: scaleMoney(mel, severity.high),
  };
}

export function scoreRisk(input: RiskFactorsInput, now: Date): RiskScore {
  assertUnitInterval(input.mitigationCoverage, 'mitigationCoverage');
  assertUnitInterval(input.concentrationShare, 'concentrationShare');
  for (const f of input.factors) {
    assertUnitInterval(f.weight, `factor[${f.key}].weight`);
    assertUnitInterval(f.likelihood, `factor[${f.key}].likelihood`);
  }
  if (input.durationDays < 0) {
    throw new DomainError('durationDays cannot be negative', 'INVALID_SCORING_INPUT');
  }
  if (input.correlatedRiskCount < 0) {
    throw new DomainError('correlatedRiskCount cannot be negative', 'INVALID_SCORING_INPUT');
  }

  const probability = computeProbability(input.factors, input.mitigationCoverage);
  const severity = computeSeverity(probability);
  const expectedLoss = computeExpectedLoss(severity, input.maximumEstimatedLoss);

  // More known correlated risks -> lower confidence that this risk is
  // independent, expressed here as a bounded penalty, never fabricated.
  const correlationValue = Math.min(1, input.correlatedRiskCount / 10);
  const correlationScore = estimate(
    correlationValue,
    input.correlatedRiskCount > 0 ? 0.6 : 0.3,
    'STATISTICAL_MODEL',
  );

  const concentrationScore = estimate(input.concentrationShare, 0.9, 'OBSERVED');

  const mitigationScore = estimate(
    input.mitigationCoverage,
    input.factors.length > 0 ? 0.7 : 0.3,
    input.factors.length > 0 ? 'EXPERT_JUDGEMENT' : 'INSUFFICIENT_DATA',
  );

  const overallConfidence = combineConfidence([
    probability.confidence,
    correlationScore.confidence,
    concentrationScore.confidence,
    mitigationScore.confidence,
  ]);

  return Object.freeze({
    riskId: input.riskId,
    probability,
    severity,
    expectedLoss,
    maximumEstimatedLoss: input.maximumEstimatedLoss,
    confidence: overallConfidence,
    durationDays: input.durationDays,
    correlationScore,
    concentrationScore,
    mitigationScore,
    computedAt: now.toISOString(),
    modelVersion: SCORING_MODEL_VERSION,
  });
}

/** A named point at which a portfolio's aggregate expected loss can be summed. */
export function aggregateExpectedLoss(
  scores: readonly RiskScore[],
  currency: string,
): { low: Money; expected: Money; high: Money } {
  const zero = money(0, currency);
  return scores.reduce(
    (acc, s) => ({
      low: addMoney(acc.low, s.expectedLoss.low),
      expected: addMoney(acc.expected, s.expectedLoss.expected),
      high: addMoney(acc.high, s.expectedLoss.high),
    }),
    { low: zero, expected: zero, high: zero },
  );
}
