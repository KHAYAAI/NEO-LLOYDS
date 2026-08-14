/**
 * The Neo-Lloyds risk ontology.
 *
 * This module is the single authority on what a risk graph may contain. Edge
 * legality is expressed as data (`EDGE_RULES`), not as scattered conditionals,
 * so the vocabulary can be published, diffed and reviewed by non-engineers.
 */

export const NODE_TYPES = [
  'ENTITY',
  'ASSET',
  'DEPENDENCY',
  'RISK',
  'HAZARD',
  'EXPOSURE',
  'EVENT',
  'LOSS',
  'POLICY',
  'COVERAGE',
  'PREMIUM',
  'CLAIM',
  'CAPITAL',
  'SYNDICATE',
  'REINSURANCE_CONTRACT',
  'SETTLEMENT',
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

export const EDGE_TYPES = [
  'OWNS',
  'DEPENDS_ON',
  'EXPOSED_TO',
  'MAY_CAUSE',
  'COVERS',
  'SUPPORTS',
  'ASSUMES',
  'PROTECTS',
  'REPRESENTS',
  'PAYS',
  'SUBJECT_TO',
] as const;

export type EdgeType = (typeof EDGE_TYPES)[number];

export interface EdgeRule {
  readonly type: EdgeType;
  readonly from: NodeType;
  readonly to: NodeType;
  /** Cycles are rejected for edges declared acyclic (e.g. DEPENDS_ON). */
  readonly acyclic: boolean;
  readonly description: string;
}

/**
 * Legal endpoints. An edge whose (type, from, to) triple is absent here cannot
 * be created — see {@link isEdgeAllowed}.
 */
export const EDGE_RULES: readonly EdgeRule[] = Object.freeze([
  {
    type: 'OWNS',
    from: 'ENTITY',
    to: 'ASSET',
    acyclic: false,
    description: 'An entity owns an asset.',
  },
  {
    type: 'DEPENDS_ON',
    from: 'ASSET',
    to: 'ASSET',
    acyclic: true,
    description: 'An asset cannot function without another asset.',
  },
  {
    type: 'EXPOSED_TO',
    from: 'ENTITY',
    to: 'RISK',
    acyclic: false,
    description: 'An entity bears exposure to a risk.',
  },
  {
    type: 'EXPOSED_TO',
    from: 'ASSET',
    to: 'RISK',
    acyclic: false,
    description: 'An asset bears exposure to a risk.',
  },
  {
    type: 'MAY_CAUSE',
    from: 'HAZARD',
    to: 'RISK',
    acyclic: false,
    description: 'A hazard gives rise to a risk.',
  },
  {
    type: 'MAY_CAUSE',
    from: 'RISK',
    to: 'EVENT',
    acyclic: false,
    description: 'A risk may materialise as an event.',
  },
  {
    type: 'MAY_CAUSE',
    from: 'EVENT',
    to: 'LOSS',
    acyclic: false,
    description: 'An event may produce a loss.',
  },
  {
    type: 'COVERS',
    from: 'POLICY',
    to: 'RISK',
    acyclic: false,
    description: 'A policy provides coverage against a risk.',
  },
  {
    type: 'COVERS',
    from: 'COVERAGE',
    to: 'RISK',
    acyclic: false,
    description: 'A coverage section responds to a risk.',
  },
  {
    type: 'SUPPORTS',
    from: 'CAPITAL',
    to: 'SYNDICATE',
    acyclic: false,
    description: 'Capital backs a syndicate’s risk-bearing capacity.',
  },
  {
    type: 'ASSUMES',
    from: 'SYNDICATE',
    to: 'RISK',
    acyclic: false,
    description: 'A syndicate assumes a risk.',
  },
  {
    type: 'PROTECTS',
    from: 'REINSURANCE_CONTRACT',
    to: 'SYNDICATE',
    acyclic: false,
    description: 'A reinsurance contract protects a syndicate.',
  },
  {
    type: 'PROTECTS',
    from: 'ENTITY',
    to: 'SYNDICATE',
    acyclic: false,
    description: 'A reinsurer entity protects a syndicate.',
  },
  {
    type: 'REPRESENTS',
    from: 'CLAIM',
    to: 'LOSS',
    acyclic: false,
    description: 'A claim asserts a loss.',
  },
  {
    type: 'PAYS',
    from: 'SETTLEMENT',
    to: 'CLAIM',
    acyclic: false,
    description: 'A settlement discharges a claim.',
  },
  {
    type: 'PAYS',
    from: 'SETTLEMENT',
    to: 'PREMIUM',
    acyclic: false,
    description: 'A settlement discharges a premium obligation.',
  },
  {
    type: 'SUBJECT_TO',
    from: 'POLICY',
    to: 'PREMIUM',
    acyclic: false,
    description: 'A policy carries a premium obligation.',
  },
]);

export function isNodeType(value: string): value is NodeType {
  return (NODE_TYPES as readonly string[]).includes(value);
}

export function isEdgeType(value: string): value is EdgeType {
  return (EDGE_TYPES as readonly string[]).includes(value);
}

export function findEdgeRule(
  type: EdgeType,
  from: NodeType,
  to: NodeType,
): EdgeRule | undefined {
  return EDGE_RULES.find(
    (rule) => rule.type === type && rule.from === from && rule.to === to,
  );
}

export function isEdgeAllowed(
  type: EdgeType,
  from: NodeType,
  to: NodeType,
): boolean {
  return findEdgeRule(type, from, to) !== undefined;
}

export function isAcyclicEdgeType(type: EdgeType): boolean {
  return EDGE_RULES.some((rule) => rule.type === type && rule.acyclic);
}

/** The ontology as a machine-readable document, for publication over the API. */
export function ontologyDocument(): {
  version: string;
  nodeTypes: readonly NodeType[];
  edgeRules: readonly EdgeRule[];
} {
  return {
    version: ONTOLOGY_VERSION,
    nodeTypes: NODE_TYPES,
    edgeRules: EDGE_RULES,
  };
}

/** Bumped whenever node types or edge rules change. Recorded on every audit. */
export const ONTOLOGY_VERSION = '1.0.0';
