import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  analystFinding,
  type AnalystProvider,
  type AnalystReport,
  type AuthContext,
} from '@neo-lloyds/domain';
import { GRAPH_REPOSITORY, type GraphRepository } from '../persistence/ports.js';
import { AuditService } from '../common/audit.service.js';
import { ANALYST_PROVIDER } from './tokens.js';

/**
 * The AI Risk Analyst service. Advisory only: this class has no method that
 * approves, prices, or binds anything — see AnalystProvider in the domain.
 * Every finding it returns has already passed through `analystFinding`,
 * which refuses ungrounded or unattributed output (ADR-0006).
 */
@Injectable()
export class AnalystService {
  constructor(
    @Inject(GRAPH_REPOSITORY) private readonly graphRepo: GraphRepository,
    @Inject(ANALYST_PROVIDER) private readonly provider: AnalystProvider,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async analyseRisk(ctx: AuthContext, riskId: string): Promise<AnalystReport> {
    const riskNode = await this.graphRepo.findNode(riskId);
    if (!riskNode) throw new NotFoundException('Risk node not found');

    const { nodes, edges } = await this.graphRepo.loadSubgraph(riskNode.organisationId);
    const neighbourIds = new Set(
      edges
        .filter((e) => e.fromId === riskId || e.toId === riskId)
        .flatMap((e) => [e.fromId, e.toId]),
    );
    const neighbours = nodes.filter((n) => neighbourIds.has(n.id) && n.id !== riskId);
    const graphSummary =
      neighbours.length > 0
        ? neighbours.map((n) => `${n.type}:${n.label}`).join(', ')
        : 'No connected nodes yet.';

    let degraded = false;
    let rawFindings;
    try {
      rawFindings = await this.provider.analyse({
        riskId,
        riskLabel: riskNode.label,
        graphSummary,
        knownFactors: [],
      });
    } catch {
      // A provider failure degrades the report; it never fabricates a finding.
      degraded = true;
      rawFindings = [
        {
          kind: 'MISSING_INFORMATION' as const,
          statement: 'The AI analyst provider failed to respond for this request.',
          confidence: 1,
          referencedData: [riskId],
          modelId: this.provider.modelId,
          modelVersion: this.provider.modelVersion,
          generatedAt: new Date().toISOString(),
        },
      ];
    }

    const findings = rawFindings.map((f) => analystFinding(f));

    await this.audit.record({
      ctx,
      action: 'analyst.risk.analyse',
      subjectType: 'RiskNode',
      subjectId: riskId,
      decision: 'ALLOWED',
      reason: `Analyst produced ${findings.length} finding(s)${degraded ? ' (degraded)' : ''}`,
      modelId: this.provider.modelId,
      modelVersion: this.provider.modelVersion,
    });

    return {
      riskId,
      findings,
      modelId: this.provider.modelId,
      modelVersion: this.provider.modelVersion,
      generatedAt: new Date().toISOString(),
      degraded,
    };
  }
}
