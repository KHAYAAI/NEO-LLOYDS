import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  assessUnderwriting,
  DomainError,
  requireAnyRole,
  requireApprovalIfNeeded,
  requireTenantAccess,
  scoreRisk,
  type ApprovalThresholds,
  type AuthContext,
  type Money,
  type RiskFactor,
  type UnderwritingApproval,
  type UnderwritingAssessment,
} from '@neo-lloyds/domain';
import { CLOCK, GRAPH_REPOSITORY, type Clock, type GraphRepository } from '../persistence/ports.js';
import { AuditService } from '../common/audit.service.js';

export interface AssessRiskRequest {
  factors: RiskFactor[];
  maximumEstimatedLoss: Money;
  durationDays: number;
  mitigationCoverage: number;
  correlatedRiskCount: number;
  concentrationShare: number;
  thresholds?: ApprovalThresholds;
}

/**
 * Underwriting service (brief §7). Composes the pure `scoreRisk` +
 * `assessUnderwriting` domain functions with persistence, tenant
 * authorisation and audit. Assessments and approvals are held in-memory in
 * Phase 3 for the same reason submissions were in Phase 2: this is where the
 * workflow and the approval-gate logic are new, and they get a durable table
 * once Phase 4 marketplace listing depends on reading them back.
 */
@Injectable()
export class UnderwritingService {
  private readonly assessments = new Map<string, UnderwritingAssessment>();
  private readonly approvals = new Map<string, UnderwritingApproval>();

  constructor(
    @Inject(GRAPH_REPOSITORY) private readonly graphRepo: GraphRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async assess(
    ctx: AuthContext,
    riskId: string,
    request: AssessRiskRequest,
  ): Promise<UnderwritingAssessment> {
    const riskNode = await this.graphRepo.findNode(riskId);
    if (!riskNode) throw new NotFoundException('Risk node not found');
    requireTenantAccess(ctx, riskNode.organisationId, 'READ');

    const score = scoreRisk(
      {
        riskId,
        factors: request.factors,
        maximumEstimatedLoss: request.maximumEstimatedLoss,
        durationDays: request.durationDays,
        mitigationCoverage: request.mitigationCoverage,
        correlatedRiskCount: request.correlatedRiskCount,
        concentrationShare: request.concentrationShare,
      },
      this.clock.now(),
    );

    const assessment = assessUnderwriting(score, request.thresholds, this.clock.now());
    this.assessments.set(riskId, assessment);

    await this.audit.record({
      ctx,
      action: 'underwriting.assess',
      subjectType: 'RiskNode',
      subjectId: riskId,
      decision: 'ALLOWED',
      reason: `Assessed as ${assessment.band} (${assessment.control}); requiresHumanApproval=${assessment.requiresHumanApproval}`,
      after: assessment,
      policy: assessment.modelVersion,
    });

    return assessment;
  }

  async getAssessment(ctx: AuthContext, riskId: string): Promise<UnderwritingAssessment> {
    const assessment = this.assessments.get(riskId);
    if (!assessment) throw new NotFoundException('No assessment recorded for this risk');
    const riskNode = await this.graphRepo.findNode(riskId);
    if (riskNode) requireTenantAccess(ctx, riskNode.organisationId, 'READ');
    return assessment;
  }

  /**
   * Records a human decision. Only an UNDERWRITER (or above, via role checks
   * upstream) may approve — this is the one write path that can satisfy
   * `requireApprovalIfNeeded`, and it is itself gated by role, not just scope.
   */
  async approve(
    ctx: AuthContext,
    riskId: string,
    decision: 'APPROVED' | 'REJECTED',
    reason: string,
  ): Promise<UnderwritingApproval> {
    requireAnyRole(ctx, ['UNDERWRITER']);

    const assessment = this.assessments.get(riskId);
    if (!assessment) throw new NotFoundException('No assessment recorded for this risk');

    const approval: UnderwritingApproval = {
      riskId,
      assessmentModelVersion: assessment.modelVersion,
      approverSubjectId: ctx.subjectId,
      decision,
      reason,
      decidedAt: this.clock.now().toISOString(),
    };
    this.approvals.set(riskId, approval);

    await this.audit.record({
      ctx,
      action: 'underwriting.approve',
      subjectType: 'RiskNode',
      subjectId: riskId,
      decision: decision === 'APPROVED' ? 'ALLOWED' : 'DENIED',
      reason,
      after: approval,
      policy: assessment.control,
    });

    return approval;
  }

  /**
   * Confirms a risk is clear to proceed to binding: throws
   * APPROVAL_REQUIRED/STALE_APPROVAL/NOT_APPROVED via the domain gate if not.
   * This is the single choke point every downstream phase (marketplace
   * listing, syndication) must call before treating a risk as underwritten.
   */
  async requireClearance(ctx: AuthContext, riskId: string): Promise<void> {
    const assessment = this.assessments.get(riskId);
    if (!assessment) {
      throw new DomainError('No underwriting assessment exists for this risk', 'NOT_ASSESSED', {
        riskId,
      });
    }
    requireApprovalIfNeeded(assessment, this.approvals.get(riskId));
  }
}
