import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  money,
  requireTenantAccess,
  scoreRisk,
  type AuthContext,
  type RiskFactor,
  type RiskScore,
} from '@neo-lloyds/domain';
import { CLOCK, GRAPH_REPOSITORY, type Clock, type GraphRepository } from '../persistence/ports.js';
import { AuditService } from '../common/audit.service.js';

export interface ScoreRiskRequest {
  factors: RiskFactor[];
  maximumEstimatedLossMinor: number;
  currency: string;
  durationDays: number;
  mitigationCoverage: number;
  correlatedRiskCount: number;
  concentrationShare: number;
}

/**
 * Deterministic scoring service. Wraps the pure `scoreRisk` domain function
 * with persistence lookup, tenant authorisation and audit — the scoring
 * arithmetic itself lives entirely in packages/domain and is unit-tested
 * there without any of this.
 */
@Injectable()
export class ScoringService {
  constructor(
    @Inject(GRAPH_REPOSITORY) private readonly graphRepo: GraphRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async score(ctx: AuthContext, riskId: string, request: ScoreRiskRequest): Promise<RiskScore> {
    const riskNode = await this.graphRepo.findNode(riskId);
    if (!riskNode) throw new NotFoundException('Risk node not found');
    requireTenantAccess(ctx, riskNode.organisationId, 'READ');

    const result = scoreRisk(
      {
        riskId,
        factors: request.factors,
        maximumEstimatedLoss: money(request.maximumEstimatedLossMinor, request.currency),
        durationDays: request.durationDays,
        mitigationCoverage: request.mitigationCoverage,
        correlatedRiskCount: request.correlatedRiskCount,
        concentrationShare: request.concentrationShare,
      },
      this.clock.now(),
    );

    await this.audit.record({
      ctx,
      action: 'scoring.risk.score',
      subjectType: 'RiskNode',
      subjectId: riskId,
      decision: 'ALLOWED',
      reason: `Scored with ${request.factors.length} factor(s), confidence ${result.confidence.toFixed(2)}`,
      after: result,
      policy: result.modelVersion,
    });

    return result;
  }
}
