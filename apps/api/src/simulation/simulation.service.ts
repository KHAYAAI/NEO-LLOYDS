import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  requireTenantAccess,
  RiskGraph,
  runSimulation,
  type AuthContext,
  type SimulationResult,
  type SimulationScenario,
} from '@neo-lloyds/domain';
import {
  GRAPH_REPOSITORY,
  SIMULATION_REPOSITORY,
  type GraphRepository,
  type SimulationRepository,
  type StoredSimulationRun,
} from '../persistence/ports.js';
import { AuditService } from '../common/audit.service.js';

/**
 * Simulation & Digital Twin (roadmap Phase 8). Every prior phase's service
 * processes something that already happened; this one runs the pure
 * `runSimulation` function (`packages/domain/src/simulation.ts`) forward from
 * an organisation's current risk graph and persists the result as a durable,
 * auditable analytical record — mirrors how Claims persists a loss decision.
 */
@Injectable()
export class SimulationService {
  constructor(
    @Inject(GRAPH_REPOSITORY) private readonly graphRepository: GraphRepository,
    @Inject(SIMULATION_REPOSITORY) private readonly runs: SimulationRepository,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async run(
    ctx: AuthContext,
    scenario: SimulationScenario,
    currency: string,
  ): Promise<StoredSimulationRun> {
    // The trigger node determines whose graph this runs against: an
    // organisation may only simulate against a node it owns, same tenant
    // isolation rule as every graph query in Phase 1.
    const triggerNode = await this.graphRepository.findNode(scenario.triggerNodeId);
    if (!triggerNode) throw new NotFoundException('Trigger node not found');
    requireTenantAccess(ctx, triggerNode.organisationId, 'READ');

    const graph = await this.loadGraph(triggerNode.organisationId);
    const result: SimulationResult = runSimulation(graph, scenario, currency);

    const stored = await this.runs.create({
      id: randomUUID(),
      organisationId: ctx.organisationId,
      requestedBy: ctx.subjectId,
      scenarioKind: scenario.kind,
      triggerNodeId: scenario.triggerNodeId,
      durationDays: scenario.durationDays,
      severity: scenario.severity,
      description: scenario.description ?? null,
      currency,
      result,
    });

    await this.audit.record({
      ctx,
      action: 'simulation.run',
      subjectType: 'SimulationRun',
      subjectId: stored.id,
      decision: 'ALLOWED',
      reason: `Ran ${scenario.kind} scenario against ${triggerNode.type} ${triggerNode.id}: ${result.affectedAssets.length} affected asset(s), ${result.exposedEntities.length} exposed entit(y/ies)`,
      after: stored,
    });

    return stored;
  }

  async get(ctx: AuthContext, id: string): Promise<StoredSimulationRun> {
    const run = await this.runs.find(id);
    if (!run) throw new NotFoundException('Simulation run not found');
    requireTenantAccess(ctx, run.organisationId, 'READ');
    return run;
  }

  async list(ctx: AuthContext): Promise<StoredSimulationRun[]> {
    return this.runs.listByOrganisation(ctx.organisationId);
  }

  private async loadGraph(organisationId: string): Promise<RiskGraph> {
    const { nodes, edges } = await this.graphRepository.loadSubgraph(organisationId);
    const graph = new RiskGraph();
    for (const node of nodes) graph.addNode(node);
    for (const edge of edges) {
      try {
        graph.addEdge(edge);
      } catch {
        // Same discipline as GraphService.loadGraph: skip edges no longer
        // legal under the current ontology rather than failing the whole run.
      }
    }
    return graph;
  }
}
