import { describe, expect, it } from 'vitest';
import {
  DomainError,
  coveredEntityIdsForRisk,
  runSimulation,
  type SimulationScenario,
} from '../src/index.js';
import { shipmentGraph } from './fixtures.js';

const graph = shipmentGraph();

function scenario(overrides: Partial<SimulationScenario> = {}): SimulationScenario {
  return {
    kind: 'PORT_CLOSURE',
    triggerNodeId: 'asset-port-durban',
    durationDays: 3,
    severity: 0.7,
    ...overrides,
  };
}

describe('runSimulation — forward from the graph', () => {
  it('finds affected assets as everything downstream of the trigger asset', () => {
    const result = runSimulation(graph, scenario(), 'ZAR');
    expect(result.affectedAssets.map((a) => a.id).sort()).toEqual([
      'asset-neighbour-cargo',
      'asset-shipment',
      'asset-vessel',
    ]);
  });

  it('finds exposed entities as owners of the trigger and affected assets', () => {
    const result = runSimulation(graph, scenario(), 'ZAR');
    expect(result.exposedEntities.map((e) => e.id)).toEqual(['co-logistics', 'co-neighbour']);
  });

  it('produces a low-confidence estimated loss, never a bare number presented as fact', () => {
    const result = runSimulation(graph, scenario(), 'ZAR');
    expect(result.estimatedLoss.confidence).toBeLessThanOrEqual(0.2);
    expect(result.estimatedLoss.basis).toBe('INSUFFICIENT_DATA');
    expect(result.estimatedLoss.expected).toBeGreaterThan(0);
    expect(result.estimatedLoss.currency).toBe('ZAR');
  });

  it('scales the loss estimate with severity and affected-asset count', () => {
    const low = runSimulation(graph, scenario({ severity: 0.1 }), 'ZAR');
    const high = runSimulation(graph, scenario({ severity: 1 }), 'ZAR');
    expect(high.estimatedLoss.expected).toBeGreaterThan(low.estimatedLoss.expected);
  });

  it('finds correlated exposure — entities that would fail alongside the exposed ones', () => {
    const result = runSimulation(graph, scenario(), 'ZAR');
    const correlatedIds = result.correlatedExposure.map((c) => c.entity.id);
    expect(correlatedIds).toContain('co-neighbour');
  });

  it('marks entities exposed to a covered risk as insured', () => {
    const result = runSimulation(graph, scenario(), 'ZAR');
    expect(result.insuredVsUninsured.insuredEntities.map((e) => e.id)).toEqual([
      'co-logistics',
      'co-neighbour',
    ]);
    expect(result.insuredVsUninsured.uninsuredEntities).toEqual([]);
  });

  it('marks exposed entities as uninsured when no policy covers the relevant risk', () => {
    // asset-vessel is a dependency, not itself exposed to any covered risk;
    // triggering from it still resolves owners, but none are exposed to
    // risk-port-closure directly enough for coverage resolution to find a match
    // unless the trigger touches that risk. Use a trigger with no EXPOSED_TO edge at all.
    const isolated = shipmentGraph();
    const result = runSimulation(isolated, scenario({ triggerNodeId: 'asset-vessel' }), 'ZAR');
    // asset-vessel has no direct EXPOSED_TO edge, so relevantRiskIds is empty
    // and every exposed entity is uninsured.
    expect(result.capitalRequirement).toEqual([]);
    expect(result.insuredVsUninsured.insuredEntities).toEqual([]);
    expect(result.insuredVsUninsured.uninsuredEntities.length).toBeGreaterThan(0);
  });

  it('reports capital bearing the risk connected to the affected assets', () => {
    const result = runSimulation(graph, scenario(), 'ZAR');
    expect(result.capitalRequirement.map((c) => c.syndicate.id)).toEqual(['syndicate-alpha']);
  });

  it('accepts an ENTITY trigger without error, producing no affected assets (documented gap: only ASSET/RISK triggers resolve affected assets)', () => {
    const result = runSimulation(graph, scenario({ triggerNodeId: 'co-logistics' }), 'ZAR');
    expect(result.affectedAssets).toEqual([]);
    expect(result.triggerNode.id).toBe('co-logistics');
  });

  it('throws a DomainError for an unknown trigger node', () => {
    expect(() => runSimulation(graph, scenario({ triggerNodeId: 'does-not-exist' }), 'ZAR')).toThrow();
  });

  it('rejects an unknown scenario kind', () => {
    expect(() =>
      runSimulation(graph, scenario({ kind: 'METEOR_STRIKE' as never }), 'ZAR'),
    ).toThrow(DomainError);
  });

  it('rejects a non-positive duration', () => {
    expect(() => runSimulation(graph, scenario({ durationDays: 0 }), 'ZAR')).toThrow(DomainError);
  });

  it('rejects a severity outside [0,1]', () => {
    expect(() => runSimulation(graph, scenario({ severity: 1.5 }), 'ZAR')).toThrow(DomainError);
  });
});

describe('coveredEntityIdsForRisk', () => {
  it('resolves the covered-entity set for a risk with a covering policy', () => {
    expect([...coveredEntityIdsForRisk(graph, 'risk-port-closure')].sort()).toEqual([
      'co-logistics',
      'co-neighbour',
    ]);
  });
});
