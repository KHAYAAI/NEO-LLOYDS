import {
  provenance,
  RiskGraph,
  type EdgeType,
  type NodeType,
  type Provenance,
  type RiskEdge,
  type RiskNode,
} from '../src/index.js';

export function testProvenance(overrides: Partial<Parameters<typeof provenance>[0]> = {}): Provenance {
  return provenance({
    sourceId: 'test-fixture',
    sourceKind: 'USER_DECLARED',
    observedAt: '2026-08-01T00:00:00Z',
    recordedAt: '2026-08-01T00:00:00Z',
    confidence: 0.9,
    ...overrides,
  });
}

export function aiProvenance(): Provenance {
  return provenance({
    sourceId: 'analyst-run-1',
    sourceKind: 'AI_INFERRED',
    observedAt: '2026-08-01T00:00:00Z',
    recordedAt: '2026-08-01T00:00:00Z',
    confidence: 0.55,
    modelId: 'risk-analyst',
    modelVersion: '0.1.0',
    referencedData: ['doc-1'],
  });
}

export function node(
  id: string,
  type: NodeType,
  overrides: Partial<RiskNode> = {},
): RiskNode {
  return {
    id,
    type,
    label: id,
    organisationId: 'org-1',
    jurisdiction: 'ZA',
    attributes: {},
    provenance: testProvenance(),
    ...overrides,
  };
}

export function edge(
  id: string,
  type: EdgeType,
  fromId: string,
  toId: string,
  overrides: Partial<RiskEdge> = {},
): RiskEdge {
  return {
    id,
    type,
    fromId,
    toId,
    attributes: {},
    provenance: testProvenance(),
    ...overrides,
  };
}

/**
 * The MVP shipment scenario: a logistics company whose shipment depends on a
 * vessel and a port, exposed to a delay risk that a policy covers and a
 * syndicate assumes, with a second company sharing the same port.
 */
export function shipmentGraph(): RiskGraph {
  return RiskGraph.from(
    [
      node('co-logistics', 'ENTITY'),
      node('co-neighbour', 'ENTITY'),
      node('asset-shipment', 'ASSET'),
      node('asset-vessel', 'ASSET'),
      node('asset-port-durban', 'ASSET'),
      node('asset-neighbour-cargo', 'ASSET'),
      node('risk-port-closure', 'RISK'),
      node('hazard-storm', 'HAZARD'),
      node('event-closure-72h', 'EVENT'),
      node('loss-spoilage', 'LOSS'),
      node('policy-marine-cargo', 'POLICY'),
      node('syndicate-alpha', 'SYNDICATE'),
      node('capital-fund-1', 'CAPITAL'),
      node('reinsurance-layer-1', 'REINSURANCE_CONTRACT'),
      node('claim-1', 'CLAIM'),
      node('settlement-1', 'SETTLEMENT'),
    ],
    [
      edge('e1', 'OWNS', 'co-logistics', 'asset-shipment'),
      edge('e2', 'DEPENDS_ON', 'asset-shipment', 'asset-vessel'),
      edge('e3', 'DEPENDS_ON', 'asset-vessel', 'asset-port-durban'),
      edge('e4', 'OWNS', 'co-neighbour', 'asset-neighbour-cargo'),
      edge('e5', 'DEPENDS_ON', 'asset-neighbour-cargo', 'asset-port-durban'),
      edge('e6', 'EXPOSED_TO', 'asset-port-durban', 'risk-port-closure'),
      edge('e7', 'MAY_CAUSE', 'hazard-storm', 'risk-port-closure'),
      edge('e8', 'MAY_CAUSE', 'risk-port-closure', 'event-closure-72h'),
      edge('e9', 'MAY_CAUSE', 'event-closure-72h', 'loss-spoilage'),
      edge('e10', 'COVERS', 'policy-marine-cargo', 'risk-port-closure'),
      edge('e11', 'ASSUMES', 'syndicate-alpha', 'risk-port-closure'),
      edge('e12', 'SUPPORTS', 'capital-fund-1', 'syndicate-alpha'),
      edge('e13', 'PROTECTS', 'reinsurance-layer-1', 'syndicate-alpha'),
      edge('e14', 'REPRESENTS', 'claim-1', 'loss-spoilage'),
      edge('e15', 'PAYS', 'settlement-1', 'claim-1'),
    ],
  );
}
