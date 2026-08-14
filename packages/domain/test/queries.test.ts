import { describe, expect, it } from 'vitest';
import {
  capitalBearingRisk,
  correlatedEntities,
  coveringPolicies,
  dependenciesOf,
  dependentsOf,
  exposedEntities,
  potentialLosses,
  whatCanFail,
} from '../src/index.js';
import { shipmentGraph } from './fixtures.js';

const graph = shipmentGraph();

describe('the six risk-graph questions', () => {
  it('Q1: what can fail — owned assets and everything they rest on', () => {
    const ids = whatCanFail(graph, 'co-logistics').map((n) => n.id).sort();
    expect(ids).toEqual(['asset-port-durban', 'asset-shipment', 'asset-vessel']);
  });

  it('Q2: what it depends on, with depth', () => {
    expect(dependenciesOf(graph, 'asset-shipment')).toEqual([
      { node: graph.requireNode('asset-vessel'), depth: 1 },
      { node: graph.requireNode('asset-port-durban'), depth: 2 },
    ]);
  });

  it('Q2 reversed: what breaks if the port closes', () => {
    const ids = dependentsOf(graph, 'asset-port-durban').map((d) => d.node.id).sort();
    expect(ids).toEqual(['asset-neighbour-cargo', 'asset-shipment', 'asset-vessel']);
  });

  it('Q3: which entities are exposed, including indirectly', () => {
    const ids = exposedEntities(graph, 'risk-port-closure').map((n) => n.id);
    // Neither company is exposed to the risk directly; both are exposed through
    // a shared dependency on the port.
    expect(ids).toEqual(['co-logistics', 'co-neighbour']);
  });

  it('Q4: which losses could result', () => {
    expect(
      potentialLosses(graph, 'risk-port-closure').map((c) => [c.event.id, c.loss.id]),
    ).toEqual([['event-closure-72h', 'loss-spoilage']]);
  });

  it('Q5: which policies cover the risk', () => {
    expect(coveringPolicies(graph, 'risk-port-closure').map((n) => n.id)).toEqual([
      'policy-marine-cargo',
    ]);
  });

  it('Q6: which capital bears the risk and what protects it', () => {
    expect(
      capitalBearingRisk(graph, 'risk-port-closure').map((b) => ({
        syndicate: b.syndicate.id,
        capital: b.capital.map((c) => c.id),
        protection: b.protection.map((p) => p.id),
      })),
    ).toEqual([
      {
        syndicate: 'syndicate-alpha',
        capital: ['capital-fund-1'],
        protection: ['reinsurance-layer-1'],
      },
    ]);
  });

  it('Q7: correlated exposure through a shared dependency', () => {
    const correlated = correlatedEntities(graph, 'co-logistics');
    expect(correlated).toHaveLength(1);
    expect(correlated[0]?.entity.id).toBe('co-neighbour');
    expect(correlated[0]?.sharedDependencies.map((n) => n.id)).toEqual([
      'asset-port-durban',
    ]);
  });

  it('reports no correlation for an entity owning nothing', () => {
    expect(whatCanFail(graph, 'co-neighbour').map((n) => n.id).sort()).toEqual([
      'asset-neighbour-cargo',
      'asset-port-durban',
    ]);
  });
});
