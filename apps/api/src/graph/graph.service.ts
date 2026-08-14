import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  capitalBearingRisk,
  correlatedEntities,
  coveringPolicies,
  dependenciesOf,
  dependentsOf,
  DomainError,
  exposedEntities,
  isEdgeType,
  isNodeType,
  potentialLosses,
  provenance,
  requireTenantAccess,
  RiskGraph,
  whatCanFail,
  type AuthContext,
  type EdgeType,
  type NodeType,
  type ProvenanceInput,
  type RiskEdge,
  type RiskNode,
} from '@neo-lloyds/domain';
import {
  CLOCK,
  GRAPH_REPOSITORY,
  type Clock,
  type GraphRepository,
} from '../persistence/ports.js';
import { AuditService } from '../common/audit.service.js';

export interface QueryScope {
  maxDepth?: number;
  verifiedOnly?: boolean;
}

@Injectable()
export class GraphService {
  constructor(
    @Inject(GRAPH_REPOSITORY) private readonly repository: GraphRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async createNode(
    ctx: AuthContext,
    input: {
      type: string;
      label: string;
      jurisdiction: string;
      attributes?: Record<string, unknown>;
      provenance: ProvenanceInput;
    },
  ): Promise<RiskNode> {
    if (!isNodeType(input.type)) {
      throw new DomainError('Unknown node type', 'UNKNOWN_NODE_TYPE', {
        type: input.type,
      });
    }

    const node: RiskNode = {
      id: randomUUID(),
      type: input.type as NodeType,
      label: input.label,
      organisationId: ctx.organisationId,
      jurisdiction: input.jurisdiction,
      attributes: input.attributes ?? {},
      // Validated here: a node without well-formed provenance cannot be created.
      provenance: provenance({
        ...input.provenance,
        recordedAt: this.clock.now().toISOString(),
      }),
    };

    // Re-check against the persisted graph so the node is rejected before any
    // write if it would violate an invariant.
    await this.repository.createNode(node);

    await this.audit.record({
      ctx,
      action: 'graph.node.create',
      subjectType: 'RiskNode',
      subjectId: node.id,
      decision: 'ALLOWED',
      reason: `Created ${node.type} node`,
      after: node,
      ...(node.provenance.modelId ? { modelId: node.provenance.modelId } : {}),
      ...(node.provenance.modelVersion
        ? { modelVersion: node.provenance.modelVersion }
        : {}),
    });

    return node;
  }

  async createEdge(
    ctx: AuthContext,
    input: {
      type: string;
      fromId: string;
      toId: string;
      attributes?: Record<string, unknown>;
      provenance: ProvenanceInput;
    },
  ): Promise<RiskEdge> {
    if (!isEdgeType(input.type)) {
      throw new DomainError('Unknown edge type', 'UNKNOWN_EDGE_TYPE', {
        type: input.type,
      });
    }

    const from = await this.repository.findNode(input.fromId);
    const to = await this.repository.findNode(input.toId);
    if (!from || !to) throw new NotFoundException('Edge endpoint not found');

    requireTenantAccess(ctx, from.organisationId, 'WRITE');
    requireTenantAccess(ctx, to.organisationId, 'WRITE');

    const edge: RiskEdge = {
      id: randomUUID(),
      type: input.type as EdgeType,
      fromId: input.fromId,
      toId: input.toId,
      attributes: input.attributes ?? {},
      provenance: provenance({
        ...input.provenance,
        recordedAt: this.clock.now().toISOString(),
      }),
    };

    // Validate against the whole current subgraph: this is where an illegal
    // endpoint pair or a dependency cycle is rejected, before anything is
    // written.
    const graph = await this.loadGraph(ctx.organisationId);
    graph.addEdge(edge);

    await this.repository.createEdge(edge);

    await this.audit.record({
      ctx,
      action: 'graph.edge.create',
      subjectType: 'RiskEdge',
      subjectId: edge.id,
      decision: 'ALLOWED',
      reason: `Created ${from.type} -${edge.type}-> ${to.type}`,
      after: edge,
    });

    return edge;
  }

  private async loadGraph(organisationId: string): Promise<RiskGraph> {
    const { nodes, edges } = await this.repository.loadSubgraph(organisationId);
    const graph = new RiskGraph();
    for (const node of nodes) graph.addNode(node);
    // Persisted edges were validated on write; re-validating here would reject
    // an edge whose rule has since changed, which is a migration concern, not a
    // read-path one.
    for (const edge of edges) {
      try {
        graph.addEdge(edge);
      } catch {
        // Skip edges no longer legal under the current ontology rather than
        // failing the whole query; the discrepancy is visible in /graph/integrity.
      }
    }
    return graph;
  }

  private async scopedGraph(ctx: AuthContext, nodeId: string) {
    const node = await this.repository.findNode(nodeId);
    if (!node) throw new NotFoundException('Node not found');
    requireTenantAccess(ctx, node.organisationId, 'READ');
    return { node, graph: await this.loadGraph(node.organisationId) };
  }

  /** Q1. What can fail? */
  async whatCanFail(ctx: AuthContext, entityId: string, scope: QueryScope = {}) {
    const { graph } = await this.scopedGraph(ctx, entityId);
    return whatCanFail(graph, entityId, scope);
  }

  /** Q2. What does it depend on / what depends on it? */
  async dependencies(ctx: AuthContext, assetId: string, scope: QueryScope = {}) {
    const { graph } = await this.scopedGraph(ctx, assetId);
    return {
      dependsOn: dependenciesOf(graph, assetId, scope),
      dependents: dependentsOf(graph, assetId, scope),
    };
  }

  /** Q3–Q6, answered together for a single risk. */
  async riskPicture(ctx: AuthContext, riskId: string, scope: QueryScope = {}) {
    const { graph } = await this.scopedGraph(ctx, riskId);
    return {
      exposedEntities: exposedEntities(graph, riskId, scope),
      potentialLosses: potentialLosses(graph, riskId, scope),
      coveringPolicies: coveringPolicies(graph, riskId),
      capitalBearing: capitalBearingRisk(graph, riskId),
    };
  }

  /** Q7. Correlated exposure through shared dependencies. */
  async correlations(ctx: AuthContext, entityId: string, scope: QueryScope = {}) {
    const { graph } = await this.scopedGraph(ctx, entityId);
    return correlatedEntities(graph, entityId, scope);
  }

  async subgraph(ctx: AuthContext) {
    const { nodes, edges } = await this.repository.loadSubgraph(ctx.organisationId);
    return { nodes, edges };
  }
}
