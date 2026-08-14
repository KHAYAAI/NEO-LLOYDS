import { describe, expect, it } from 'vitest';
import {
  addMoney,
  allocateMoney,
  assertAgentMayAct,
  AuthorizationError,
  combineConfidence,
  isVerifiedSource,
  money,
  MoneyError,
  presentValue,
  probability,
  provenance,
  ProvenanceError,
  rangeEstimate,
  requireAnyRole,
  requireTenantAccess,
  sumMoney,
  type AgentMandate,
  type AuthContext,
  type Organisation,
} from '../src/index.js';

describe('money is exact (ADR-0005)', () => {
  it('refuses non-integer minor units', () => {
    expect(() => money(10.5, 'USD')).toThrow(MoneyError);
  });

  it('refuses cross-currency arithmetic', () => {
    expect(() => addMoney(money(100, 'USD'), money(100, 'ZAR'))).toThrow(MoneyError);
  });

  it('never loses or invents a minor unit when allocating', () => {
    const total = money(100_00, 'USD');
    const parts = allocateMoney(total, [20, 25, 15, 40]);
    expect(sumMoney(parts, 'USD')).toEqual(total);
  });

  it('allocates an indivisible remainder deterministically', () => {
    const parts = allocateMoney(money(10, 'USD'), [1, 1, 1]);
    expect(parts.map((p) => p.amountMinor)).toEqual([4, 3, 3]);
    expect(sumMoney(parts, 'USD').amountMinor).toBe(10);
  });

  it('preserves the total for negative amounts', () => {
    const parts = allocateMoney(money(-101, 'USD'), [1, 1]);
    expect(sumMoney(parts, 'USD').amountMinor).toBe(-101);
  });
});

describe('uncertainty is mandatory and never overstated', () => {
  it('rejects a probability outside [0,1]', () => {
    expect(() => probability(1.2, 0.5, 'STATISTICAL_MODEL')).toThrow();
  });

  it('rejects an incoherent range', () => {
    expect(() => rangeEstimate(10, 5, 20, 0.8, 'OBSERVED')).toThrow();
  });

  it('is only as confident as its weakest input', () => {
    expect(combineConfidence([0.9, 0.4, 0.8])).toBe(0.4);
  });

  it('suppresses false precision at low confidence', () => {
    expect(presentValue(2_134_567, 0.3)).toBe(2_000_000);
    expect(presentValue(2_134_567, 0.95)).toBe(2_130_000);
  });
});

describe('provenance (ADR-0006)', () => {
  it('rejects AI-inferred values without a model identity', () => {
    expect(() =>
      provenance({
        sourceId: 's',
        sourceKind: 'AI_INFERRED',
        observedAt: '2026-08-01T00:00:00Z',
        recordedAt: '2026-08-01T00:00:00Z',
        confidence: 0.6,
      }),
    ).toThrow(ProvenanceError);
  });

  it('rejects AI-inferred values with no referenced source data', () => {
    expect(() =>
      provenance({
        sourceId: 's',
        sourceKind: 'AI_INFERRED',
        observedAt: '2026-08-01T00:00:00Z',
        recordedAt: '2026-08-01T00:00:00Z',
        confidence: 0.6,
        modelId: 'm',
        modelVersion: '1',
        referencedData: [],
      }),
    ).toThrow(ProvenanceError);
  });

  it('rejects observation after recording', () => {
    expect(() =>
      provenance({
        sourceId: 's',
        sourceKind: 'SENSOR',
        observedAt: '2026-08-02T00:00:00Z',
        recordedAt: '2026-08-01T00:00:00Z',
        confidence: 1,
      }),
    ).toThrow(ProvenanceError);
  });

  it('never treats an AI claim as a verified fact', () => {
    const p = provenance({
      sourceId: 's',
      sourceKind: 'AI_INFERRED',
      observedAt: '2026-08-01T00:00:00Z',
      recordedAt: '2026-08-01T00:00:00Z',
      confidence: 0.99,
      modelId: 'm',
      modelVersion: '1',
      referencedData: ['doc-1'],
    });
    expect(isVerifiedSource(p)).toBe(false);
  });
});

describe('authorisation', () => {
  const base: AuthContext = {
    organisationId: 'org-1',
    subjectId: 'user-1',
    subjectKind: 'USER',
    roles: ['BROKER'],
    scopes: ['graph:read'],
  };

  it('requires the market role, not the request body', () => {
    expect(() => requireAnyRole(base, ['SYNDICATE'])).toThrow(AuthorizationError);
    expect(() => requireAnyRole(base, ['BROKER', 'SYNDICATE'])).not.toThrow();
  });

  it('isolates tenants', () => {
    expect(() => requireTenantAccess(base, 'org-2', 'READ')).toThrow(AuthorizationError);
    expect(() => requireTenantAccess(base, 'org-1', 'WRITE')).not.toThrow();
  });

  it('lets a regulator read across tenants but never write', () => {
    const regulator: AuthContext = { ...base, roles: ['REGULATOR'] };
    expect(() => requireTenantAccess(regulator, 'org-2', 'READ')).not.toThrow();
    expect(() => requireTenantAccess(regulator, 'org-2', 'WRITE')).toThrow(
      AuthorizationError,
    );
  });
});

describe('agents cannot exceed their mandate (security-model.md §4)', () => {
  const principal: Organisation = {
    id: 'org-principal',
    legalName: 'Test Principal (Pty) Ltd',
    kind: 'COMPANY',
    jurisdiction: 'ZA',
    kybStatus: 'VERIFIED',
    roles: ['RISK_ORIGINATOR'],
    active: true,
  };

  const mandate: AgentMandate = {
    agentOrganisationId: 'org-agent',
    principalOrganisationId: 'org-principal',
    permittedActions: ['risk.submit'],
    maxTransactionValueMinor: 1_000_000,
    currency: 'USD',
    expiresAt: '2030-01-01T00:00:00Z',
  };

  const agent: AuthContext = {
    organisationId: 'org-agent',
    subjectId: 'agent-1',
    subjectKind: 'AGENT',
    roles: ['RISK_ORIGINATOR'],
    scopes: ['graph:write'],
    principalOrganisationId: 'org-principal',
    mandate,
  };

  const opts = { requireVerifiedPrincipal: true, now: new Date('2026-08-13T00:00:00Z') };

  it('permits an in-mandate action', () => {
    expect(() =>
      assertAgentMayAct(agent, 'risk.submit', 500_000, principal, opts),
    ).not.toThrow();
  });

  it('refuses an action outside the mandate', () => {
    expect(() =>
      assertAgentMayAct(agent, 'coverage.bind', 1, principal, opts),
    ).toThrow(AuthorizationError);
  });

  it('refuses a value above the ceiling', () => {
    expect(() =>
      assertAgentMayAct(agent, 'risk.submit', 1_000_001, principal, opts),
    ).toThrow(AuthorizationError);
  });

  it('refuses an unverified principal', () => {
    expect(() =>
      assertAgentMayAct(
        agent,
        'risk.submit',
        1,
        { ...principal, kybStatus: 'PENDING' },
        opts,
      ),
    ).toThrow(AuthorizationError);
  });

  it('refuses an expired mandate', () => {
    const expired: AuthContext = {
      ...agent,
      mandate: { ...mandate, expiresAt: '2020-01-01T00:00:00Z' },
    };
    expect(() => assertAgentMayAct(expired, 'risk.submit', 1, principal, opts)).toThrow(
      AuthorizationError,
    );
  });

  it('refuses an agent with no mandate at all', () => {
    const { mandate: _omitted, ...rest } = agent;
    expect(() =>
      assertAgentMayAct(rest as AuthContext, 'risk.submit', 1, principal, opts),
    ).toThrow(AuthorizationError);
  });
});
