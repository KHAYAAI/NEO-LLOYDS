import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  applyReinsuranceProgram,
  DomainError,
  money,
  requireAnyRole,
  requireTenantAccess,
  requireValidLayerParams,
  type AuthContext,
  type Money,
  type ReinsuranceLayer,
  type ReinsuranceLayerKind,
  type ReinsuranceLayerParams,
} from '@neo-lloyds/domain';
import {
  REINSURANCE_REPOSITORY,
  type ReinsuranceRepository,
  type StoredReinsuranceCession,
  type StoredReinsuranceProgram,
} from '../persistence/ports.js';
import { AuditService } from '../common/audit.service.js';

/**
 * Reinsurance (roadmap Phase 9). This service composes the pure
 * `applyReinsuranceProgram` (`packages/domain/src/reinsurance.ts`) with
 * persistence, tenant authorisation and audit — same pattern as every prior
 * phase. Cedes are computed against a cedant organisation's own program;
 * there is no counterparty organisation modelled as "the reinsurer" yet
 * (see docs/reports/phase-9.md) — a program is configuration the cedant
 * holds, not a bilateral binding contract.
 */
@Injectable()
export class ReinsuranceService {
  constructor(
    @Inject(REINSURANCE_REPOSITORY) private readonly repository: ReinsuranceRepository,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async createProgram(
    ctx: AuthContext,
    input: {
      name: string;
      currency: string;
      layers: readonly { order: number; kind: ReinsuranceLayerKind; params: ReinsuranceLayerParams }[];
    },
  ): Promise<StoredReinsuranceProgram> {
    requireAnyRole(ctx, ['SYNDICATE']);

    for (const layer of input.layers) requireValidLayerParams(layer.params);

    const orders = input.layers.map((l) => l.order);
    if (new Set(orders).size !== orders.length) {
      throw new DomainError('Layer orders must be unique within a program', 'DUPLICATE_LAYER_ORDER', {
        orders,
      });
    }

    const program = await this.repository.createProgram({
      id: randomUUID(),
      organisationId: ctx.organisationId,
      name: input.name,
      currency: input.currency,
      layers: input.layers.map((l) => ({ id: randomUUID(), order: l.order, kind: l.kind, params: l.params })),
    });

    await this.audit.record({
      ctx,
      action: 'reinsurance.program.create',
      subjectType: 'ReinsuranceProgram',
      subjectId: program.id,
      decision: 'ALLOWED',
      reason: `Created program "${program.name}" with ${program.layers.length} layer(s)`,
      after: program,
    });

    return program;
  }

  async getProgram(ctx: AuthContext, id: string): Promise<StoredReinsuranceProgram> {
    const program = await this.mustFindProgram(id);
    requireTenantAccess(ctx, program.organisationId, 'READ');
    return program;
  }

  async listPrograms(ctx: AuthContext): Promise<StoredReinsuranceProgram[]> {
    return this.repository.listProgramsByOrganisation(ctx.organisationId);
  }

  /**
   * THE CESSION CALCULATION. Runs a gross loss through a program's layers,
   * in order, and persists the result. AGGREGATE layers' running state is
   * read from the program as currently stored and, on success, written back
   * — so a second cession against the same program correctly sees what the
   * first one already consumed of the aggregate attachment/limit.
   */
  async cede(
    ctx: AuthContext,
    programId: string,
    grossLoss: Money,
    claimId: string | null,
  ): Promise<StoredReinsuranceCession> {
    const program = await this.mustFindProgram(programId);
    requireTenantAccess(ctx, program.organisationId, 'WRITE');

    if (grossLoss.currency !== program.currency) {
      throw new DomainError(
        `Cession currency ${grossLoss.currency} does not match program currency ${program.currency}`,
        'CURRENCY_MISMATCH',
        { cessionCurrency: grossLoss.currency, programCurrency: program.currency },
      );
    }

    const layers: ReinsuranceLayer[] = program.layers.map((l) => ({
      id: l.id,
      order: l.order,
      params: l.params,
      state:
        l.kind === 'AGGREGATE'
          ? {
              consumedGross: money(l.aggregateConsumedGrossMinor, program.currency),
              consumedCeded: money(l.aggregateConsumedCededMinor, program.currency),
            }
          : undefined,
    }));

    const result = applyReinsuranceProgram(grossLoss, layers);

    for (const layerResult of result.perLayer) {
      if (layerResult.nextState) {
        await this.repository.updateLayerAggregateState(
          layerResult.layerId,
          layerResult.nextState.consumedGross,
          layerResult.nextState.consumedCeded,
        );
      }
    }

    const cession = await this.repository.recordCession({
      id: randomUUID(),
      programId: program.id,
      claimId,
      grossLoss: result.grossLoss,
      totalCeded: result.totalCeded,
      netRetained: result.netRetained,
      perLayer: result.perLayer,
    });

    await this.audit.record({
      ctx,
      action: 'reinsurance.cede',
      subjectType: 'ReinsuranceCession',
      subjectId: cession.id,
      decision: 'ALLOWED',
      reason: `Ceded ${result.totalCeded.amountMinor} of ${result.grossLoss.amountMinor} ${result.grossLoss.currency} across ${result.perLayer.length} layer(s)${claimId ? ` for claim ${claimId}` : ''}`,
      after: cession,
    });

    return cession;
  }

  async listCessions(ctx: AuthContext, programId: string): Promise<StoredReinsuranceCession[]> {
    const program = await this.mustFindProgram(programId);
    requireTenantAccess(ctx, program.organisationId, 'READ');
    return this.repository.listCessionsByProgram(programId);
  }

  private async mustFindProgram(id: string): Promise<StoredReinsuranceProgram> {
    const program = await this.repository.findProgram(id);
    if (!program) throw new NotFoundException('Reinsurance program not found');
    return program;
  }
}
