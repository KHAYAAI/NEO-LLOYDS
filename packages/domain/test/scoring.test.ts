import { describe, expect, it } from 'vitest';
import {
  aggregateExpectedLoss,
  analystFinding,
  canTransition,
  DomainError,
  money,
  requireTransition,
  scoreRisk,
  type RiskFactor,
} from '../src/index.js';

const now = new Date('2026-08-14T00:00:00Z');

function factor(overrides: Partial<RiskFactor> = {}): RiskFactor {
  return {
    key: 'storm-frequency',
    description: 'Historical storm closure frequency at this port',
    weight: 1,
    likelihood: 0.2,
    confidence: 0.8,
    basis: 'STATISTICAL_MODEL',
    ...overrides,
  };
}

describe('deterministic risk scoring', () => {
  it('is reproducible: identical input yields identical output', () => {
    const input = {
      riskId: 'risk-1',
      factors: [factor()],
      maximumEstimatedLoss: money(500_000_00, 'USD'),
      durationDays: 30,
      mitigationCoverage: 0.1,
      correlatedRiskCount: 2,
      concentrationShare: 0.05,
    };
    expect(scoreRisk(input, now)).toEqual(scoreRisk(input, now));
  });

  it('returns INSUFFICIENT_DATA probability with no factors, never a guess', () => {
    const score = scoreRisk(
      {
        riskId: 'risk-1',
        factors: [],
        maximumEstimatedLoss: money(1_000_00, 'USD'),
        durationDays: 1,
        mitigationCoverage: 0,
        correlatedRiskCount: 0,
        concentrationShare: 0,
      },
      now,
    );
    expect(score.probability.basis).toBe('INSUFFICIENT_DATA');
    expect(score.probability.expected).toBe(0);
  });

  it('discounts probability by mitigation coverage', () => {
    const base = { riskId: 'r', factors: [factor()], maximumEstimatedLoss: money(1_00, 'USD'), durationDays: 1, correlatedRiskCount: 0, concentrationShare: 0 };
    const unmitigated = scoreRisk({ ...base, mitigationCoverage: 0 }, now);
    const mitigated = scoreRisk({ ...base, mitigationCoverage: 0.5 }, now);
    expect(mitigated.probability.expected).toBeLessThan(unmitigated.probability.expected);
  });

  it('never reports expected loss above maximum estimated loss', () => {
    const score = scoreRisk(
      {
        riskId: 'r',
        factors: [factor({ likelihood: 1, confidence: 0.99 })],
        maximumEstimatedLoss: money(1_000_00, 'USD'),
        durationDays: 1,
        mitigationCoverage: 0,
        correlatedRiskCount: 0,
        concentrationShare: 0,
      },
      now,
    );
    expect(score.expectedLoss.high.amountMinor).toBeLessThanOrEqual(1_000_00);
  });

  it('widens the severity band as confidence falls', () => {
    const confident = scoreRisk(
      { riskId: 'r', factors: [factor({ confidence: 0.95 })], maximumEstimatedLoss: money(1_00, 'USD'), durationDays: 1, mitigationCoverage: 0, correlatedRiskCount: 0, concentrationShare: 0 },
      now,
    );
    const unsure = scoreRisk(
      { riskId: 'r', factors: [factor({ confidence: 0.2 })], maximumEstimatedLoss: money(1_00, 'USD'), durationDays: 1, mitigationCoverage: 0, correlatedRiskCount: 0, concentrationShare: 0 },
      now,
    );
    const confidentSpread = confident.severity.high - confident.severity.low;
    const unsureSpread = unsure.severity.high - unsure.severity.low;
    expect(unsureSpread).toBeGreaterThan(confidentSpread);
  });

  it('rejects a factor weight outside [0,1]', () => {
    expect(() =>
      scoreRisk(
        {
          riskId: 'r',
          factors: [factor({ weight: 1.5 })],
          maximumEstimatedLoss: money(1_00, 'USD'),
          durationDays: 1,
          mitigationCoverage: 0,
          correlatedRiskCount: 0,
          concentrationShare: 0,
        },
        now,
      ),
    ).toThrow(DomainError);
  });

  it('aggregates expected loss across a portfolio exactly', () => {
    const a = scoreRisk({ riskId: 'a', factors: [factor()], maximumEstimatedLoss: money(100_00, 'USD'), durationDays: 1, mitigationCoverage: 0, correlatedRiskCount: 0, concentrationShare: 0 }, now);
    const b = scoreRisk({ riskId: 'b', factors: [factor()], maximumEstimatedLoss: money(200_00, 'USD'), durationDays: 1, mitigationCoverage: 0, correlatedRiskCount: 0, concentrationShare: 0 }, now);
    const total = aggregateExpectedLoss([a, b], 'USD');
    expect(total.expected.amountMinor).toBe(a.expectedLoss.expected.amountMinor + b.expectedLoss.expected.amountMinor);
  });
});

describe('AI analyst findings are never ungrounded (ADR-0006)', () => {
  it('rejects a finding with no referenced data', () => {
    expect(() =>
      analystFinding({
        kind: 'SUMMARY',
        statement: 'This risk looks moderate.',
        confidence: 0.6,
        referencedData: [],
        modelId: 'analyst-v1',
        modelVersion: '0.1.0',
        generatedAt: now.toISOString(),
      }),
    ).toThrow(DomainError);
  });

  it('rejects a finding with no model attribution', () => {
    expect(() =>
      analystFinding({
        kind: 'SUMMARY',
        statement: 'x',
        confidence: 0.6,
        referencedData: ['node-1'],
        modelId: '',
        modelVersion: '',
        generatedAt: now.toISOString(),
      }),
    ).toThrow(DomainError);
  });

  it('accepts a fully grounded finding', () => {
    const finding = analystFinding({
      kind: 'MISSING_INFORMATION',
      statement: 'No wind-speed data is attached for this port.',
      confidence: 0.9,
      referencedData: ['node-port-durban'],
      modelId: 'analyst-v1',
      modelVersion: '0.1.0',
      generatedAt: now.toISOString(),
    });
    expect(finding.kind).toBe('MISSING_INFORMATION');
  });
});

describe('submission state machine', () => {
  it('only allows forward transitions', () => {
    expect(canTransition('DRAFT', 'SUBMITTED')).toBe(true);
    expect(canTransition('SUBMITTED', 'DRAFT')).toBe(false);
    expect(canTransition('DRAFT', 'SCORED')).toBe(false);
  });

  it('throws a domain error on an illegal transition', () => {
    expect(() => requireTransition('READY_FOR_UNDERWRITING', 'DRAFT')).toThrow(DomainError);
  });
});
