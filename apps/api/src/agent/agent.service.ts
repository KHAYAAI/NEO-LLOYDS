import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  assertAgentMayAct,
  DomainError,
  mayProceedWithoutHuman,
  type AuthContext,
  type Money,
} from '@neo-lloyds/domain';
import {
  CLOCK,
  IDENTITY_REPOSITORY,
  type Clock,
  type IdentityRepository,
} from '../persistence/ports.js';
import { AuditService } from '../common/audit.service.js';
import { SubmissionService } from '../submission/submission.service.js';
import { AnalystService } from '../analyst/analyst.service.js';
import { UnderwritingService } from '../underwriting/underwriting.service.js';
import { MarketplaceService } from '../marketplace/marketplace.service.js';
import { SettlementService } from '../settlement/settlement.service.js';

/**
 * The AI Agent API (roadmap Phase 11): authenticate → submit activity →
 * request assessment → indicative protection → coverage options → human
 * approval where required → permitted execution → settlement information.
 *
 * This module does not reimplement any of that — every step delegates to
 * the service a human caller would use for the same action
 * (`SubmissionService`, `AnalystService`, `UnderwritingService`,
 * `MarketplaceService`, `SettlementService`). What Phase 11 actually adds is
 * the one thing no prior phase wired end to end: a real call to
 * `assertAgentMayAct` (`packages/domain/src/identity.ts`, built in Phase 1,
 * unit-tested since, never called from a live request path until now)
 * before every step, so an agent's mandate — its permitted actions, its
 * transaction ceiling, its expiry, its principal's active/KYB status — is
 * actually enforced, not just modelled. For a human caller
 * (`ctx.subjectKind !== 'AGENT'`), `assertAgentMayAct` is a documented no-op
 * (security-model.md §4), so these same endpoints work for a human broker
 * too — that symmetry is deliberate, not an oversight: "the agent path"
 * must never be a separate path that could drift from the human one.
 */
@Injectable()
export class AgentService {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SubmissionService) private readonly submissions: SubmissionService,
    @Inject(AnalystService) private readonly analyst: AnalystService,
    @Inject(UnderwritingService) private readonly underwriting: UnderwritingService,
    @Inject(MarketplaceService) private readonly marketplace: MarketplaceService,
    @Inject(SettlementService) private readonly settlement: SettlementService,
  ) {}

  private async mandateCheck(ctx: AuthContext, action: string, valueMinor: number): Promise<void> {
    const principal = ctx.principalOrganisationId
      ? await this.identity.findOrganisation(ctx.principalOrganisationId)
      : undefined;

    assertAgentMayAct(ctx, action, valueMinor, principal, {
      // Same production-only gate as security-model.md §4's KYB requirement:
      // a real deployment must not let an unverified principal's agent act,
      // but requiring it in every test/dev environment would make the
      // mandate machinery untestable without standing up KYB fixtures first.
      requireVerifiedPrincipal: process.env.NODE_ENV === 'production',
      now: this.clock.now(),
    });

    if (ctx.subjectKind === 'AGENT') {
      await this.audit.record({
        ctx,
        action: 'agent.mandate.check',
        subjectType: 'AgentMandate',
        subjectId: ctx.subjectId,
        decision: 'ALLOWED',
        reason: `Action "${action}" (value ${valueMinor}) within mandate`,
      });
    }
  }

  /** Step 1: submit activity — a risk submission, mandate-checked before it happens. */
  async submitActivity(ctx: AuthContext, input: { riskId: string; title: string }) {
    await this.mandateCheck(ctx, 'activity.submit', 0);
    return this.submissions.create(ctx, input);
  }

  /** Step 2: request assessment — the advisory AI analyst report, never a decision. */
  async requestAssessment(ctx: AuthContext, riskId: string) {
    await this.mandateCheck(ctx, 'risk.assess', 0);
    return this.analyst.analyseRisk(ctx, riskId);
  }

  /**
   * Step 3: indicative protection. Deliberately named "indicative", never
   * "approved" or "bound" — this surfaces the underwriting assessment
   * already on record (Phase 3) plus whether it is currently clear to
   * proceed, but creates no new assessment and binds nothing. If no
   * assessment exists yet, that is reported plainly rather than fabricated.
   */
  async indicativeProtection(ctx: AuthContext, riskId: string) {
    await this.mandateCheck(ctx, 'protection.indicative', 0);
    const assessment = await this.underwriting.getAssessment(ctx, riskId);

    let clearToProceed = true;
    let clearanceNote = 'Clear to proceed to binding.';
    try {
      await this.underwriting.requireClearance(ctx, riskId);
    } catch (error) {
      clearToProceed = false;
      clearanceNote = error instanceof DomainError ? error.message : 'Not clear to proceed.';
    }

    return {
      riskId,
      band: assessment.band,
      control: assessment.control,
      humanApprovalRequired: !mayProceedWithoutHuman(assessment.band),
      clearToProceed,
      clearanceNote,
      indicative: true as const,
      disclosure: 'This is an indicative assessment, not a binding offer of protection.',
    };
  }

  /** Step 4: coverage options — open marketplace listings, read-only, no binding. */
  async coverageOptions(ctx: AuthContext, filter: { riskClass?: string; jurisdiction?: string }) {
    await this.mandateCheck(ctx, 'coverage.browse', 0);
    return this.marketplace.browseListings(filter);
  }

  /**
   * Step 6: permitted execution. This is where a mandate's transaction
   * ceiling is actually load-bearing: `valueMinor` is the indicative amount
   * the agent wants to commit, checked against `mandate.maxTransactionValueMinor`
   * before `MarketplaceService.expressInterest` ever runs. Expressing
   * interest is itself non-binding (Phase 4) — this phase's contribution is
   * that an agent cannot even reach that non-binding step outside its
   * mandate.
   */
  async permittedExecution(
    ctx: AuthContext,
    listingId: string,
    indicativeAmount: Money,
    note?: string,
  ) {
    await this.mandateCheck(ctx, 'coverage.bind', indicativeAmount.amountMinor);
    return this.marketplace.expressInterest(ctx, listingId, indicativeAmount, note);
  }

  /** Step 7: settlement information — read-only status of a settlement already initiated by a human process. */
  async settlementInformation(ctx: AuthContext, transactionId: string) {
    await this.mandateCheck(ctx, 'settlement.read', 0);
    const transaction = await this.settlement.get(ctx, transactionId);
    if (!transaction) throw new NotFoundException('Settlement transaction not found');
    return transaction;
  }
}
