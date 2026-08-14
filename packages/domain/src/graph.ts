import {
  DependencyCycleError,
  InvalidEdgeError,
  UnknownNodeError,
} from './errors.js';
import {
  isAcyclicEdgeType,
  isEdgeAllowed,
  type EdgeType,
  type NodeType,
} from './ontology.js';
import type { Provenance } from './provenance.js';

export interface RiskNode {
  readonly id: string;
  readonly type: NodeType;
  readonly label: string;
  /** Owning organisation — the unit of tenant isolation. */
  readonly organisationId: string;
  /** ISO-3166-1 alpha-2. No default: jurisdiction is always explicit (ADR-0004). */
  readonly jurisdiction: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly provenance: Provenance;
}

export interface RiskEdge {
  readonly id: string;
  readonly type: EdgeType;
  readonly fromId: string;
  readonly toId: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly provenance: Provenance;
}

/**
 * An in-memory view of a risk graph or subgraph.
 *
 * Deliberately pure and storage-agnostic: the same class backs a test fixture
 * and a subgraph loaded from PostgreSQL, so traversal behaviour cannot diverge
 * between them (ADR-0003).
 */
export class RiskGraph {
  private readonly nodes = new Map<string, RiskNode>();
  private readonly edges = new Map<string, RiskEdge>();
  private readonly outgoing = new Map<string, Set<string>>();
  private readonly incoming = new Map<string, Set<string>>();

  static from(nodes: readonly RiskNode[], edges: readonly RiskEdge[]): RiskGraph {
    const graph = new RiskGraph();
    for (const node of nodes) graph.addNode(node);
    for (const edge of edges) graph.addEdge(edge);
    return graph;
  }

  addNode(node: RiskNode): void {
    this.nodes.set(node.id, node);
    if (!this.outgoing.has(node.id)) this.outgoing.set(node.id, new Set());
    if (!this.incoming.has(node.id)) this.incoming.set(node.id, new Set());
  }

  /**
   * Adds an edge after checking it against the ontology. Rejects unknown
   * endpoints, illegal type triples, and cycles on acyclic edge types.
   */
  addEdge(edge: RiskEdge): void {
    const from = this.nodes.get(edge.fromId);
    const to = this.nodes.get(edge.toId);
    if (!from) throw new UnknownNodeError(edge.fromId);
    if (!to) throw new UnknownNodeError(edge.toId);

    if (!isEdgeAllowed(edge.type, from.type, to.type)) {
      throw new InvalidEdgeError(
        `The ontology does not permit ${from.type} -${edge.type}-> ${to.type}`,
        { edgeType: edge.type, fromType: from.type, toType: to.type },
      );
    }

    if (edge.fromId === edge.toId && isAcyclicEdgeType(edge.type)) {
      throw new DependencyCycleError('A node cannot depend on itself', {
        nodeId: edge.fromId,
      });
    }

    if (isAcyclicEdgeType(edge.type) && this.reaches(edge.toId, edge.fromId, edge.type)) {
      throw new DependencyCycleError(
        `Edge ${edge.fromId} -${edge.type}-> ${edge.toId} would create a cycle`,
        { fromId: edge.fromId, toId: edge.toId, edgeType: edge.type },
      );
    }

    this.edges.set(edge.id, edge);
    this.outgoing.get(edge.fromId)?.add(edge.id);
    this.incoming.get(edge.toId)?.add(edge.id);
  }

  getNode(id: string): RiskNode | undefined {
    return this.nodes.get(id);
  }

  requireNode(id: string): RiskNode {
    const node = this.nodes.get(id);
    if (!node) throw new UnknownNodeError(id);
    return node;
  }

  allNodes(): readonly RiskNode[] {
    return [...this.nodes.values()];
  }

  allEdges(): readonly RiskEdge[] {
    return [...this.edges.values()];
  }

  nodesOfType(type: NodeType): readonly RiskNode[] {
    return this.allNodes().filter((node) => node.type === type);
  }

  /** Edges leaving `nodeId`, optionally filtered by edge type. */
  edgesFrom(nodeId: string, type?: EdgeType): readonly RiskEdge[] {
    return this.resolve(this.outgoing.get(nodeId), type);
  }

  /** Edges arriving at `nodeId`, optionally filtered by edge type. */
  edgesTo(nodeId: string, type?: EdgeType): readonly RiskEdge[] {
    return this.resolve(this.incoming.get(nodeId), type);
  }

  private resolve(ids: Set<string> | undefined, type?: EdgeType): RiskEdge[] {
    if (!ids) return [];
    const result: RiskEdge[] = [];
    for (const id of ids) {
      const edge = this.edges.get(id);
      if (edge && (type === undefined || edge.type === type)) result.push(edge);
    }
    return result;
  }

  /** Is `to` reachable from `from` following only edges of `type`? */
  private reaches(from: string, to: string, type: EdgeType): boolean {
    const seen = new Set<string>([from]);
    const queue = [from];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      if (current === to) return true;
      for (const edge of this.edgesFrom(current, type)) {
        if (!seen.has(edge.toId)) {
          seen.add(edge.toId);
          queue.push(edge.toId);
        }
      }
    }
    return false;
  }

  /**
   * Breadth-first traversal with a depth bound and a visited set, in either
   * direction. Every traversal in the system funnels through here so that the
   * depth bound can never be forgotten.
   */
  traverse(options: {
    startIds: readonly string[];
    edgeTypes?: readonly EdgeType[];
    direction?: 'OUT' | 'IN';
    maxDepth?: number;
    /** Exclude AI-inferred edges when only verified data may be relied on. */
    verifiedOnly?: boolean;
  }): Map<string, number> {
    const {
      startIds,
      edgeTypes,
      direction = 'OUT',
      maxDepth = 8,
      verifiedOnly = false,
    } = options;

    const depths = new Map<string, number>();
    let frontier: string[] = [];

    for (const id of startIds) {
      this.requireNode(id);
      if (!depths.has(id)) {
        depths.set(id, 0);
        frontier.push(id);
      }
    }

    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
      const next: string[] = [];
      for (const nodeId of frontier) {
        const edges =
          direction === 'OUT' ? this.edgesFrom(nodeId) : this.edgesTo(nodeId);
        for (const edge of edges) {
          if (edgeTypes && !edgeTypes.includes(edge.type)) continue;
          if (verifiedOnly && edge.provenance.sourceKind === 'AI_INFERRED') continue;
          const neighbour = direction === 'OUT' ? edge.toId : edge.fromId;
          if (!depths.has(neighbour)) {
            depths.set(neighbour, depth);
            next.push(neighbour);
          }
        }
      }
      frontier = next;
    }

    return depths;
  }
}
