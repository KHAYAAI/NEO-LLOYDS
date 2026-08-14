import { DomainError } from './errors.js';
import type { Money } from './money.js';
import { compareMoney, money, scaleMoney } from './money.js';
import type { RiskScore } from './scoring.js';
import type { ApprovalBand } from './identity.js';
import { controlFor, mayProceedWithoutHuman, type ApprovalControl } from './identity.js';

/**
 * Underwriting (brief §7): turns a RiskScore into an UnderwritingAssessment.
 * This module computes a *recommendation* only. It cannot bind anything —
 * there is no function here that produces a bound policy, and the approval
 * band it computes is enforced by the API layer refusing to progress a
 * submission past ANALYSING/SCORED without the matching human decision
 * recorded (security-model.md §5).
 */

/** Configurable per jurisdiction/product — this is the Phase 3 default set. */
export interface ApprovalThresholds {
  /** Expected-loss-to-MEL ratio below which a risk is LOW band. */
  readonly lowMaxRatio: number;
  /** ... below which MEDIUM. Above this is HIGH. */
  readonly mediumMaxRatio: number;
  /** ... below which HIGH. Above this is EXTREME regardless of ratio. */
  readonly highMaxRatio: number;
  /** Absolute expected-loss ceiling for LOW regardless of ratio. */
  readonly lowMaxExpectedLoss: Money;
  /** Confidence below which a risk is never LOW, no matter how small. */
  readonly minConfidenceForAutomation: number;
}

export const DEFAULT_APPROVAL_THRESHOLDS: ApprovalThresholds = Object.freeze({
  lowMaxRatio: 0.05,
  mediumMaxRatio: 0.2,
  highMaxRatio: 0.5,
  lowMaxExpectedLoss: money(50_000_00, 'USD'),
  minConfidenceForAutomation: 0.75,
});

/** Where a RiskScore's expected loss falls determines the approval band. */
export function classifyBand(
  score: RiskScore,
  thresholds: ApprovalThresholds = DEFAULT_APPROVAL_THRESHOLDS,
): ApprovalBand {
  if (score.maximumEstimatedLoss.currency !== thresholds.lowMaxExpectedLoss.currency) {
    throw new DomainError(
      'Approval thresholds are currency-scoped; convert before classifying',
      'CURRENCY_MISMATCH',
      { scoreCurrency: score.maximumEstimatedLoss.currency, thresholdCurrency: thresholds.lowMaxExpectedLoss.currency },
    );
  }

  const melMinor = score.maximumEstimatedLoss.amountMinor;
  const ratio = melMinor === 0 ? 0 : score.expectedLoss.expected.amountMinor / melMinor;

  const underAbsoluteCeiling =
    compareMoney(score.expectedLoss.expected, thresholds.lowMaxExpectedLoss) <= 0;
  // Gated on the probability estimate's own confidence, not the blended
  // overall score.confidence: correlation/concentration/mitigation carry a
  // deliberately conservative confidence ceiling (see scoring.ts) that would
  // otherwise make LOW unreachable even for a well-understood, low-size risk.
  const confidentEnoughToAutomate =
    score.probability.confidence >= thresholds.minConfidenceForAutomation;

  if (ratio <= thresholds.lowMaxRatio && underAbsoluteCeiling && confidentEnoughToAutomate) {
    return 'LOW';
  }
  if (ratio <= thresholds.mediumMaxRatio) return 'MEDIUM';
  if (ratio <= thresholds.highMaxRatio) return 'HIGH';
  return 'EXTREME';
}

export interface UnderwritingAssessment {
  readonly riskId: string;
  readonly eligible: boolean;
  readonly band: ApprovalBand;
  readonly control: ApprovalControl;
  readonly requiresHumanApproval: boolean;
  readonly riskScoreConfidence: number;
  readonly expectedLoss: Money;
  readonly suggestedPremiumRange: { low: Money; high: Money };
  readonly capitalRequirement: Money;
  readonly suggestedCapacity: Money;
  readonly exclusions: readonly string[];
  readonly conditions: readonly string[];
  readonly requiredEvidence: readonly string[];
  readonly modelVersion: string;
  readonly assessedAt: string;
}

export const UNDERWRITING_MODEL_VERSION = 'underwriting-deterministic-v1';

/** Premium loads a margin onto expected loss; margin widens as confidence falls. */
function suggestPremiumRange(score: RiskScore): { low: Money; high: Money } {
  const marginLow = 1.15; // 15% margin over expected loss, minimum
  const uncertaintyLoad = 1 - score.confidence; // 0 (certain) .. 1 (no data)
  const marginHigh = 1.15 + uncertaintyLoad * 0.85; // widens toward 2x as confidence -> 0

  return {
    low: scaleMoney(score.expectedLoss.expected, marginLow),
    high: scaleMoney(score.expectedLoss.high, marginHigh),
  };
}

/**
 * Capital requirement is set to the high end of the expected-loss range
 * (a simple, explainable capital-adequacy stand-in — not an actuarial
 * reserving methodology; see docs/reports/phase-3.md for what a real one
 * requires). Suggested capacity offered to the market is the MEL itself,
 * since that is the plausible maximum the syndicate could be asked to pay.
 */
export function assessUnderwriting(
  score: RiskScore,
  thresholds: ApprovalThresholds = DEFAULT_APPROVAL_THRESHOLDS,
  now: Date = new Date(),
): UnderwritingAssessment {
  const band = classifyBand(score, thresholds);
  const control = controlFor(band);
  const requiresHumanApproval = !mayProceedWithoutHuman(band);

  const exclusions: string[] = [];
  const conditions: string[] = [];
  const requiredEvidence: string[] = [];

  if (score.confidence < thresholds.minConfidenceForAutomation) {
    requiredEvidence.push(
      'Additional risk-factor evidence required: confidence below automation threshold.',
    );
  }
  if (score.correlationScore.expected > 0.3) {
    conditions.push('Subject to portfolio correlation review before binding.');
  }
  if (score.concentrationScore.expected > 0.1) {
    conditions.push('Subject to concentration-limit review before binding.');
  }
  if (score.probability.basis === 'INSUFFICIENT_DATA') {
    exclusions.push('Not eligible: insufficient data to price this risk.');
  }

  const eligible = score.probability.basis !== 'INSUFFICIENT_DATA';

  return Object.freeze({
    riskId: score.riskId,
    eligible,
    band,
    control,
    requiresHumanApproval,
    riskScoreConfidence: score.confidence,
    expectedLoss: score.expectedLoss.expected,
    suggestedPremiumRange: suggestPremiumRange(score),
    capitalRequirement: score.expectedLoss.high,
    suggestedCapacity: score.maximumEstimatedLoss,
    exclusions: Object.freeze(exclusions),
    conditions: Object.freeze(conditions),
    requiredEvidence: Object.freeze(requiredEvidence),
    modelVersion: UNDERWRITING_MODEL_VERSION,
    assessedAt: now.toISOString(),
  });
}

/**
 * A recorded human (or senior-governance) decision on an assessment that
 * required one. This is the only mechanism by which a HIGH/EXTREME/
 * unconfident MEDIUM assessment may proceed — there is no code path that
 * treats "band computed" as "approved" (security-model.md §5, ADR-0006).
 */
export interface UnderwritingApproval {
  readonly riskId: string;
  readonly assessmentModelVersion: string;
  readonly approverSubjectId: string;
  readonly decision: 'APPROVED' | 'REJECTED';
  readonly reason: string;
  readonly decidedAt: string;
}

export function requireApprovalIfNeeded(
  assessment: UnderwritingAssessment,
  approval: UnderwritingApproval | undefined,
): void {
  if (!assessment.requiresHumanApproval) return;

  if (!approval) {
    throw new DomainError(
      `A ${assessment.band} assessment requires ${assessment.control} approval before it can proceed`,
      'APPROVAL_REQUIRED',
      { riskId: assessment.riskId, band: assessment.band, control: assessment.control },
    );
  }
  if (approval.assessmentModelVersion !== assessment.modelVersion) {
    throw new DomainError(
      'Approval was recorded against a different assessment model version; re-approval required',
      'STALE_APPROVAL',
      { approvalVersion: approval.assessmentModelVersion, assessmentVersion: assessment.modelVersion },
    );
  }
  if (approval.decision !== 'APPROVED') {
    throw new DomainError('This risk was not approved for underwriting', 'NOT_APPROVED', {
      riskId: assessment.riskId,
      decision: approval.decision,
    });
  }
}
