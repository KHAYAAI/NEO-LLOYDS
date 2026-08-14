import type { RiskGraph, RiskNode } from './graph.js';

/**
 * The questions the risk graph exists to answer (domain-model.md §3).
 * Each is a named, pure function so it can be tested, versioned and cited in
 * an audit record.
 */

export interface QueryOptions {
  readonly maxDepth?: number;
  /** Exclude AI-inferred edges. Use when a decision requires verified data. */
  readonly verifiedOnly?: boolean;
}

/** Q1. What can fail? Assets an entity owns, transitively through dependencies. */
export function whatCanFail(
  graph: RiskGraph,
  entityId: string,
  options: QueryOptions = {},
): readonly RiskNode[] {
  const entity = graph.requireNode(entityId);
  const owned = graph
    .edgesFrom(entity.id, 'OWNS')
    .map((edge) => edge.toId);

  if (owned.length === 0) return [];

  const reached = graph.traverse({
    startIds: owned,
    edgeTypes: ['DEPENDS_ON'],
    direction: 'OUT',
    maxDepth: options.maxDepth ?? 8,
    verifiedOnly: options.verifiedOnly ?? false,
  });

  return [...reached.keys()].map((id) => graph.requireNode(id));
}

/** Q2. What does it depend on? Transitive DEPENDS_ON closure of an asset. */
export function dependenciesOf(
  graph: RiskGraph,
  assetId: string,
  options: QueryOptions = {},
): readonly { node: RiskNode; depth: number }[] {
  const reached = graph.traverse({
    startIds: [assetId],
    edgeTypes: ['DEPENDS_ON'],
    direction: 'OUT',
    maxDepth: options.maxDepth ?? 8,
    verifiedOnly: options.verifiedOnly ?? false,
  });

  return [...reached.entries()]
    .filter(([id]) => id !== assetId)
    .map(([id, depth]) => ({ node: graph.requireNode(id), depth }))
    .sort((a, b) => a.depth - b.depth || a.node.id.localeCompare(b.node.id));
}

/** Reverse of Q2: what would be affected if this asset failed? */
export function dependentsOf(
  graph: RiskGraph,
  assetId: string,
  options: QueryOptions = {},
): readonly { node: RiskNode; depth: number }[] {
  const reached = graph.traverse({
    startIds: [assetId],
    edgeTypes: ['DEPENDS_ON'],
    direction: 'IN',
    maxDepth: options.maxDepth ?? 8,
    verifiedOnly: options.verifiedOnly ?? false,
  });

  return [...reached.entries()]
    .filter(([id]) => id !== assetId)
    .map(([id, depth]) => ({ node: graph.requireNode(id), depth }))
    .sort((a, b) => a.depth - b.depth || a.node.id.localeCompare(b.node.id));
}

/**
 * Q3. Which entities are exposed to a risk?
 * Directly via ENTITY -EXPOSED_TO-> RISK, and indirectly via assets that are
 * exposed and the owners of anything depending on those assets.
 */
export function exposedEntities(
  graph: RiskGraph,
  riskId: string,
  options: QueryOptions = {},
): readonly RiskNode[] {
  graph.requireNode(riskId);
  const found = new Map<string, RiskNode>();

  const exposedDirectly = graph.edgesTo(riskId, 'EXPOSED_TO').map((e) => e.fromId);

  for (const id of exposedDirectly) {
    const node = graph.requireNode(id);
    if (node.type === 'ENTITY') {
      found.set(node.id, node);
      continue;
    }
    if (node.type !== 'ASSET') continue;

    // The exposed asset, plus everything that depends on it, implicates owners.
    const impacted = graph.traverse({
      startIds: [node.id],
      edgeTypes: ['DEPENDS_ON'],
      direction: 'IN',
      maxDepth: options.maxDepth ?? 8,
      verifiedOnly: options.verifiedOnly ?? false,
    });

    for (const assetId of impacted.keys()) {
      for (const ownership of graph.edgesTo(assetId, 'OWNS')) {
        const owner = graph.requireNode(ownership.fromId);
        found.set(owner.id, owner);
      }
    }
  }

  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Q4. What losses could result from a risk? RISK -> EVENT -> LOSS chains. */
export function potentialLosses(
  graph: RiskGraph,
  riskId: string,
  options: QueryOptions = {},
): readonly { event: RiskNode; loss: RiskNode }[] {
  graph.requireNode(riskId);
  const chains: { event: RiskNode; loss: RiskNode }[] = [];
  const verifiedOnly = options.verifiedOnly ?? false;

  for (const riskToEvent of graph.edgesFrom(riskId, 'MAY_CAUSE')) {
    if (verifiedOnly && riskToEvent.provenance.sourceKind === 'AI_INFERRED') continue;
    const event = graph.requireNode(riskToEvent.toId);
    if (event.type !== 'EVENT') continue;

    for (const eventToLoss of graph.edgesFrom(event.id, 'MAY_CAUSE')) {
      if (verifiedOnly && eventToLoss.provenance.sourceKind === 'AI_INFERRED') continue;
      const loss = graph.requireNode(eventToLoss.toId);
      if (loss.type === 'LOSS') chains.push({ event, loss });
    }
  }

  return chains;
}

/** Q5. Which policies and coverages respond to a risk? */
export function coveringPolicies(
  graph: RiskGraph,
  riskId: string,
): readonly RiskNode[] {
  graph.requireNode(riskId);
  return graph
    .edgesTo(riskId, 'COVERS')
    .map((edge) => graph.requireNode(edge.fromId))
    .filter((node) => node.type === 'POLICY' || node.type === 'COVERAGE')
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Q6. Which capital bears a risk, and who protects the bearer?
 * CAPITAL -SUPPORTS-> SYNDICATE -ASSUMES-> RISK, plus PROTECTS on the syndicate.
 */
export function capitalBearingRisk(
  graph: RiskGraph,
  riskId: string,
): readonly {
  syndicate: RiskNode;
  capital: readonly RiskNode[];
  protection: readonly RiskNode[];
}[] {
  graph.requireNode(riskId);

  return graph
    .edgesTo(riskId, 'ASSUMES')
    .map((edge) => graph.requireNode(edge.fromId))
    .filter((node) => node.type === 'SYNDICATE')
    .map((syndicate) => ({
      syndicate,
      capital: graph
        .edgesTo(syndicate.id, 'SUPPORTS')
        .map((edge) => graph.requireNode(edge.fromId))
        .filter((node) => node.type === 'CAPITAL'),
      protection: graph
        .edgesTo(syndicate.id, 'PROTECTS')
        .map((edge) => graph.requireNode(edge.fromId)),
    }))
    .sort((a, b) => a.syndicate.id.localeCompare(b.syndicate.id));
}

/**
 * Q7. Correlated exposure: entities that share a dependency with the subject.
 * This is the input to concentration limits and, later, to AI-catastrophe
 * modelling — the case where many actors fail together because they rest on
 * the same thing.
 */
export function correlatedEntities(
  graph: RiskGraph,
  entityId: string,
  options: QueryOptions = {},
): readonly { entity: RiskNode; sharedDependencies: readonly RiskNode[] }[] {
  const subject = graph.requireNode(entityId);
  const subjectDeps = new Set(
    whatCanFail(graph, subject.id, options).map((node) => node.id),
  );
  if (subjectDeps.size === 0) return [];

  const results: { entity: RiskNode; sharedDependencies: RiskNode[] }[] = [];

  for (const candidate of graph.nodesOfType('ENTITY')) {
    if (candidate.id === subject.id) continue;
    const shared = whatCanFail(graph, candidate.id, options).filter((node) =>
      subjectDeps.has(node.id),
    );
    if (shared.length > 0) {
      results.push({ entity: candidate, sharedDependencies: shared });
    }
  }

  return results.sort(
    (a, b) =>
      b.sharedDependencies.length - a.sharedDependencies.length ||
      a.entity.id.localeCompare(b.entity.id),
  );
}
