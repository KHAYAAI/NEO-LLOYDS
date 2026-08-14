import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  requireTenantAccess,
  requireTransition,
  type AuthContext,
  type RiskSubmission,
  type SubmissionStatus,
} from '@neo-lloyds/domain';
import { CLOCK, GRAPH_REPOSITORY, type Clock, type GraphRepository } from '../persistence/ports.js';
import { AuditService } from '../common/audit.service.js';

/**
 * In-memory submission store for Phase 2. Submissions reference a risk
 * already in the graph; the workflow itself (brief §8) is what's new here —
 * persisting it to its own table is a Phase 4 marketplace concern once
 * listing and capital interest exist to act on it.
 */
@Injectable()
export class SubmissionService {
  private readonly submissions = new Map<string, RiskSubmission>();

  constructor(
    @Inject(GRAPH_REPOSITORY) private readonly graphRepo: GraphRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async create(ctx: AuthContext, input: { riskId: string; title: string }): Promise<RiskSubmission> {
    const riskNode = await this.graphRepo.findNode(input.riskId);
    if (!riskNode) throw new NotFoundException('Risk node not found');
    requireTenantAccess(ctx, riskNode.organisationId, 'WRITE');

    const now = this.clock.now().toISOString();
    const submission: RiskSubmission = {
      id: randomUUID(),
      organisationId: ctx.organisationId,
      riskId: input.riskId,
      title: input.title,
      status: 'DRAFT',
      submittedBy: ctx.subjectId,
      createdAt: now,
      updatedAt: now,
    };
    this.submissions.set(submission.id, submission);

    await this.audit.record({
      ctx,
      action: 'submission.create',
      subjectType: 'RiskSubmission',
      subjectId: submission.id,
      decision: 'ALLOWED',
      reason: `Risk submission drafted for risk ${input.riskId}`,
      after: submission,
    });

    return submission;
  }

  async advance(
    ctx: AuthContext,
    id: string,
    to: SubmissionStatus,
  ): Promise<RiskSubmission> {
    const before = this.submissions.get(id);
    if (!before) throw new NotFoundException('Submission not found');
    requireTenantAccess(ctx, before.organisationId, 'WRITE');

    // Throws INVALID_SUBMISSION_TRANSITION if `to` is not reachable from the
    // current status; this is the single place the workflow order is enforced.
    requireTransition(before.status, to);

    const after: RiskSubmission = {
      ...before,
      status: to,
      updatedAt: this.clock.now().toISOString(),
    };
    this.submissions.set(id, after);

    await this.audit.record({
      ctx,
      action: 'submission.transition',
      subjectType: 'RiskSubmission',
      subjectId: id,
      decision: 'ALLOWED',
      reason: `${before.status} -> ${to}`,
      before,
      after,
    });

    return after;
  }

  async get(ctx: AuthContext, id: string): Promise<RiskSubmission> {
    const submission = this.submissions.get(id);
    if (!submission) throw new NotFoundException('Submission not found');
    requireTenantAccess(ctx, submission.organisationId, 'READ');
    return submission;
  }

  async list(ctx: AuthContext): Promise<RiskSubmission[]> {
    return [...this.submissions.values()].filter(
      (s) => s.organisationId === ctx.organisationId,
    );
  }
}
