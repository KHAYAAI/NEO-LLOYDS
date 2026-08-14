import { describe, expect, it } from 'vitest';
import {
  assessUnderwriting,
  classifyBand,
  DomainError,
  money,
  requireApprovalIfNeeded,
  scoreRisk,
  type RiskFactor,
  type UnderwritingApproval,
} from '../src/index.js';

const now = new Date('2026-08-14T00:00:00Z');

function factor(overrides: Partial<RiskFactor> = {}): RiskFactor {
  return {
    key: 'f',
    description: 'd',
    weight: 1,
    likelihood: 0.05,
    confidence: 0.9,
    basis: 'STATISTICAL_MODEL',
    ...overrides,
  };
}

function scored(overrides: Partial<Parameters<typeof scoreRisk>[0]> = {}) {
  return scoreRisk(
    {
      riskId: 'risk-1',
      factors: [factor()],
      maximumEstimatedLoss: money(1_000_000_00, 'USD'),
      durationDays: 30,
      mitigationCoverage: 0,
      correlatedRiskCount: 0,
      concentrationShare: 0,
      ...overrides,
    },
    now,
  );
}

describe('approval band classification', () => {
  it('classifies a small, confident, well-mitigated risk as LOW', () => {
    const score = scored({ factors: [factor({ likelihood: 0.02, confidence: 0.95 })] });
    expect(classifyBand(score)).toBe('LOW');
  });

  it('classifies a large-ratio risk as EXTREME regardless of confidence', () => {
    const score = scored({ factors: [factor({ likelihood: 0.9, confidence: 0.95 })] });
    expect(classifyBand(score)).toBe('EXTREME');
  });

  it('never classifies a low-confidence risk as LOW, however small the ratio', () => {
    const score = scored({ factors: [factor({ likelihood: 0.01, confidence: 0.3 })] });
    expect(classifyBand(score)).not.toBe('LOW');
  });

  it('rejects mismatched currencies rather than silently comparing them', () => {
    const score = scored({ maximumEstimatedLoss: money(1_000_00, 'ZAR') });
    expect(() => classifyBand(score)).toThrow(DomainError);
  });
});

describe('assessUnderwriting', () => {
  it('never returns eligible=true for INSUFFICIENT_DATA', () => {
    const score = scored({ factors: [] });
    const assessment = assessUnderwriting(score, undefined, now);
    expect(assessment.eligible).toBe(false);
    expect(assessment.exclusions.length).toBeGreaterThan(0);
  });

  it('LOW band never requires human approval; everything else does', () => {
    const low = assessUnderwriting(
      scored({ factors: [factor({ likelihood: 0.01, confidence: 0.95 })] }),
      undefined,
      now,
    );
    const extreme = assessUnderwriting(
      scored({ factors: [factor({ likelihood: 0.9, confidence: 0.95 })] }),
      undefined,
      now,
    );
    expect(low.requiresHumanApproval).toBe(false);
    expect(extreme.requiresHumanApproval).toBe(true);
    expect(extreme.control).toBe('SENIOR_GOVERNANCE');
  });

  it('suggested premium is never below expected loss', () => {
    const assessment = assessUnderwriting(scored(), undefined, now);
    expect(assessment.suggestedPremiumRange.low.amountMinor).toBeGreaterThanOrEqual(
      assessment.expectedLoss.amountMinor,
    );
  });

  it('widens the premium ceiling as confidence falls', () => {
    const confident = assessUnderwriting(
      scored({ factors: [factor({ confidence: 0.95 })] }),
      undefined,
      now,
    );
    const unsure = assessUnderwriting(
      scored({ factors: [factor({ confidence: 0.3 })] }),
      undefined,
      now,
    );
    expect(unsure.suggestedPremiumRange.high.amountMinor).toBeGreaterThan(
      confident.suggestedPremiumRange.high.amountMinor,
    );
  });
});

describe('human-approval gate (security-model.md §5)', () => {
  it('blocks progress on a HIGH-band assessment with no approval recorded', () => {
    const assessment = assessUnderwriting(
      scored({ factors: [factor({ likelihood: 0.3, confidence: 0.9 })] }),
      undefined,
      now,
    );
    expect(assessment.band).not.toBe('LOW');
    expect(() => requireApprovalIfNeeded(assessment, undefined)).toThrow(DomainError);
  });

  it('never blocks a LOW-band assessment even with no approval', () => {
    const assessment = assessUnderwriting(
      scored({ factors: [factor({ likelihood: 0.01, confidence: 0.95 })] }),
      undefined,
      now,
    );
    expect(() => requireApprovalIfNeeded(assessment, undefined)).not.toThrow();
  });

  it('rejects an approval recorded against a stale model version', () => {
    const assessment = assessUnderwriting(
      scored({ factors: [factor({ likelihood: 0.3 })] }),
      undefined,
      now,
    );
    const stale: UnderwritingApproval = {
      riskId: assessment.riskId,
      assessmentModelVersion: 'some-old-version',
      approverSubjectId: 'user-1',
      decision: 'APPROVED',
      reason: 'looks fine',
      decidedAt: now.toISOString(),
    };
    expect(() => requireApprovalIfNeeded(assessment, stale)).toThrow(DomainError);
  });

  it('rejects an explicit REJECTED decision', () => {
    const assessment = assessUnderwriting(
      scored({ factors: [factor({ likelihood: 0.3 })] }),
      undefined,
      now,
    );
    const rejected: UnderwritingApproval = {
      riskId: assessment.riskId,
      assessmentModelVersion: assessment.modelVersion,
      approverSubjectId: 'user-1',
      decision: 'REJECTED',
      reason: 'too risky',
      decidedAt: now.toISOString(),
    };
    expect(() => requireApprovalIfNeeded(assessment, rejected)).toThrow(DomainError);
  });

  it('accepts a matching, approved decision', () => {
    const assessment = assessUnderwriting(
      scored({ factors: [factor({ likelihood: 0.3 })] }),
      undefined,
      now,
    );
    const approval: UnderwritingApproval = {
      riskId: assessment.riskId,
      assessmentModelVersion: assessment.modelVersion,
      approverSubjectId: 'user-1',
      decision: 'APPROVED',
      reason: 'reviewed and acceptable',
      decidedAt: now.toISOString(),
    };
    expect(() => requireApprovalIfNeeded(assessment, approval)).not.toThrow();
  });
});
