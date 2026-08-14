import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  requireTenantAccess,
  requireTransition,
  type AuthContext,
  type RiskSubmission,
  type SubmissionStatus,
} from '@neo-lloyds/domain';
import {
  CLOCK,
  GRAPH_REPOSITORY,
  SUBMISSION_REPOSITORY,
  type Clock,
  type GraphRepository,
  type SubmissionRepository,
} from '../persistence/ports.js';
import { AuditService } from '../common/audit.service.js';

/**
 * Durable from Phase 4: a submission is written through `SubmissionRepository`
 * (Prisma in production, in-memory in tests), so it survives a restart — it
 * has to, once `POST /marketplace/listings` needs to read a
 * READY_FOR_UNDERWRITING submission back to list it.
 */
@Injectable()
export class SubmissionService {
  constructor(
    @Inject(GRAPH_REPOSITORY) private readonly graphRepo: GraphRepository,
    @Inject(SUBMISSION_REPOSITORY) private readonly submissions: SubmissionRepository,
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
    const created = await this.submissions.create(submission);

    await this.audit.record({
      ctx,
      action: 'submission.create',
      subjectType: 'RiskSubmission',
      subjectId: created.id,
      decision: 'ALLOWED',
      reason: `Risk submission drafted for risk ${input.riskId}`,
      after: created,
    });

    return created;
  }

  async advance(
    ctx: AuthContext,
    id: string,
    to: SubmissionStatus,
  ): Promise<RiskSubmission> {
    const before = await this.submissions.find(id);
    if (!before) throw new NotFoundException('Submission not found');
    requireTenantAccess(ctx, before.organisationId, 'WRITE');

    // Throws INVALID_SUBMISSION_TRANSITION if `to` is not reachable from the
    // current status; this is the single place the workflow order is enforced.
    requireTransition(before.status, to);

    const after = await this.submissions.advance(id, to, this.clock.now());
    if (!after) throw new NotFoundException('Submission not found');

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
    const submission = await this.submissions.find(id);
    if (!submission) throw new NotFoundException('Submission not found');
    requireTenantAccess(ctx, submission.organisationId, 'READ');
    return submission;
  }

  async list(ctx: AuthContext): Promise<RiskSubmission[]> {
    return this.submissions.listByOrganisation(ctx.organisationId);
  }
}
