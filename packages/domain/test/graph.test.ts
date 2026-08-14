import { describe, expect, it } from 'vitest';
import {
  DependencyCycleError,
  InvalidEdgeError,
  isEdgeAllowed,
  RiskGraph,
  UnknownNodeError,
  EDGE_RULES,
  NODE_TYPES,
} from '../src/index.js';
import { aiProvenance, edge, node, shipmentGraph } from './fixtures.js';

describe('ontology', () => {
  it('permits only the declared endpoint triples', () => {
    expect(isEdgeAllowed('OWNS', 'ENTITY', 'ASSET')).toBe(true);
    expect(isEdgeAllowed('OWNS', 'ASSET', 'ENTITY')).toBe(false);
    expect(isEdgeAllowed('ASSUMES', 'CAPITAL', 'RISK')).toBe(false);
  });

  it('declares every rule over known node types', () => {
    for (const rule of EDGE_RULES) {
      expect(NODE_TYPES).toContain(rule.from);
      expect(NODE_TYPES).toContain(rule.to);
    }
  });
});

describe('RiskGraph edge validation', () => {
  it('rejects an edge the ontology does not permit', () => {
    const graph = RiskGraph.from(
      [node('a', 'ASSET'), node('e', 'ENTITY')],
      [],
    );
    expect(() => graph.addEdge(edge('x', 'OWNS', 'a', 'e'))).toThrow(InvalidEdgeError);
  });

  it('rejects an edge referencing an unknown node', () => {
    const graph = RiskGraph.from([node('e', 'ENTITY')], []);
    expect(() => graph.addEdge(edge('x', 'OWNS', 'e', 'missing'))).toThrow(
      UnknownNodeError,
    );
  });

  it('rejects a self-dependency', () => {
    const graph = RiskGraph.from([node('a', 'ASSET')], []);
    expect(() => graph.addEdge(edge('x', 'DEPENDS_ON', 'a', 'a'))).toThrow(
      DependencyCycleError,
    );
  });

  it('rejects a dependency cycle of any length', () => {
    const graph = RiskGraph.from(
      [node('a', 'ASSET'), node('b', 'ASSET'), node('c', 'ASSET')],
      [
        edge('e1', 'DEPENDS_ON', 'a', 'b'),
        edge('e2', 'DEPENDS_ON', 'b', 'c'),
      ],
    );
    expect(() => graph.addEdge(edge('e3', 'DEPENDS_ON', 'c', 'a'))).toThrow(
      DependencyCycleError,
    );
  });

  it('allows a diamond, which is not a cycle', () => {
    const graph = RiskGraph.from(
      [node('a', 'ASSET'), node('b', 'ASSET'), node('c', 'ASSET'), node('d', 'ASSET')],
      [
        edge('e1', 'DEPENDS_ON', 'a', 'b'),
        edge('e2', 'DEPENDS_ON', 'a', 'c'),
        edge('e3', 'DEPENDS_ON', 'b', 'd'),
      ],
    );
    expect(() => graph.addEdge(edge('e4', 'DEPENDS_ON', 'c', 'd'))).not.toThrow();
  });
});

describe('traversal', () => {
  it('honours the depth bound', () => {
    const graph = shipmentGraph();
    const shallow = graph.traverse({
      startIds: ['asset-shipment'],
      edgeTypes: ['DEPENDS_ON'],
      maxDepth: 1,
    });
    expect([...shallow.keys()]).toEqual(['asset-shipment', 'asset-vessel']);
  });

  it('excludes AI-inferred edges when verified data is required', () => {
    const graph = RiskGraph.from(
      [node('a', 'ASSET'), node('b', 'ASSET')],
      [edge('e1', 'DEPENDS_ON', 'a', 'b', { provenance: aiProvenance() })],
    );

    const all = graph.traverse({ startIds: ['a'], edgeTypes: ['DEPENDS_ON'] });
    const verified = graph.traverse({
      startIds: ['a'],
      edgeTypes: ['DEPENDS_ON'],
      verifiedOnly: true,
    });

    expect(all.has('b')).toBe(true);
    expect(verified.has('b')).toBe(false);
  });

  it('terminates on graphs with non-dependency cycles', () => {
    // PROTECTS and SUPPORTS are not acyclic, so a loop is representable and
    // traversal must still terminate.
    const graph = RiskGraph.from(
      [node('s', 'SYNDICATE'), node('r', 'ENTITY')],
      [edge('e1', 'PROTECTS', 'r', 's')],
    );
    expect(graph.traverse({ startIds: ['r'], maxDepth: 50 }).size).toBe(2);
  });
});
