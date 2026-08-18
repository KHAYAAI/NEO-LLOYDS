import { DomainError } from './errors.js';
import { addMoney, compareMoney, money, subtractMoney, type Money } from './money.js';

/**
 * Reinsurance (roadmap Phase 9). Configurable layers over a cedant's own
 * retained loss — quota share, excess of loss, aggregate protection — built
 * as software abstractions a program can be configured with, not as
 * regulated reinsurance contracts. Nothing here binds a real reinsurer to
 * anything; it computes, precisely and auditably, how a given loss would
 * split between what a cedant retains and what each configured layer would
 * cede, exactly the same "compute the math, do not fabricate the legal
 * effect" discipline as every other phase.
 *
 * Deliberately built independently of `claims.ts`: a reinsurance program
 * protects a cedant's book generally, not one specific claim's payout
 * mechanics, so this module takes a bare `Money` loss in and returns a bare
 * cession result out. The API layer (`apps/api/src/reinsurance`) is what
 * optionally ties a cession to a specific claim id for audit purposes.
 */

export const REINSURANCE_LAYER_KINDS = ['QUOTA_SHARE', 'EXCESS_OF_LOSS', 'AGGREGATE'] as const;
export type ReinsuranceLayerKind = (typeof REINSURANCE_LAYER_KINDS)[number];

export function isReinsuranceLayerKind(value: string): value is ReinsuranceLayerKind {
  return (REINSURANCE_LAYER_KINDS as readonly string[]).includes(value);
}

/** Cedes a fixed proportion of every loss, up to an optional per-loss cap. */
export interface QuotaShareParams {
  readonly kind: 'QUOTA_SHARE';
  /** Basis points of every loss ceded to this layer, e.g. 3000 = 30%. */
  readonly cededBps: number;
  /** Optional cap on how much this layer will cede from a single loss. */
  readonly perLossLimit?: Money;
}

/** Cedes the portion of a loss between an attachment point and a limit above it, per occurrence. */
export interface ExcessOfLossParams {
  readonly kind: 'EXCESS_OF_LOSS';
  readonly attachmentPoint: Money;
  readonly limit: Money;
}

/**
 * Cedes losses once their *cumulative* total (as processed by this layer,
 * across every prior cession) exceeds an attachment point, up to an
 * aggregate limit for the whole program period. Requires the caller to carry
 * forward `consumedGross`/`consumedCeded` between cessions — this module is
 * pure and stateless, so that running total is the API layer's persistence
 * responsibility (`ReinsuranceLayerState` below), not something hidden here.
 */
export interface AggregateParams {
  readonly kind: 'AGGREGATE';
  readonly attachmentPoint: Money;
  readonly limit: Money;
}

export type ReinsuranceLayerParams = QuotaShareParams | ExcessOfLossParams | AggregateParams;

/** Running state an AGGREGATE layer must carry between cessions. Ignored by the other two kinds. */
export interface ReinsuranceLayerState {
  readonly consumedGross: Money;
  readonly consumedCeded: Money;
}

export interface ReinsuranceLayer {
  readonly id: string;
  /** Application order within the program: layer 1 applies to the gross loss, layer 2 to what layer 1 left retained, and so on. */
  readonly order: number;
  readonly params: ReinsuranceLayerParams;
  /** Only meaningful for AGGREGATE layers; ignored otherwise. */
  readonly state?: ReinsuranceLayerState;
}

export interface LayerCessionResult {
  readonly layerId: string;
  readonly kind: ReinsuranceLayerKind;
  readonly lossPresented: Money;
  readonly ceded: Money;
  readonly retained: Money;
  /** Only present for AGGREGATE layers: the state after this cession, to persist for the next one. */
  readonly nextState?: ReinsuranceLayerState;
}

export interface ProgramCessionResult {
  readonly grossLoss: Money;
  readonly perLayer: readonly LayerCessionResult[];
  readonly totalCeded: Money;
  readonly netRetained: Money;
}

function requireNonNegative(m: Money, field: string): void {
  if (m.amountMinor < 0) {
    throw new DomainError(`${field} must not be negative`, 'INVALID_REINSURANCE_PARAMETER', {
      field,
      amountMinor: m.amountMinor,
    });
  }
}

export function requireValidLayerParams(params: ReinsuranceLayerParams): void {
  if (!isReinsuranceLayerKind(params.kind)) {
    throw new DomainError('Unknown reinsurance layer kind', 'UNKNOWN_LAYER_KIND', {
      kind: params.kind,
    });
  }
  if (params.kind === 'QUOTA_SHARE') {
    if (!Number.isInteger(params.cededBps) || params.cededBps <= 0 || params.cededBps > 10_000) {
      throw new DomainError('cededBps must be an integer in (0, 10000]', 'INVALID_REINSURANCE_PARAMETER', {
        cededBps: params.cededBps,
      });
    }
    if (params.perLossLimit) requireNonNegative(params.perLossLimit, 'perLossLimit');
  } else {
    requireNonNegative(params.attachmentPoint, 'attachmentPoint');
    requireNonNegative(params.limit, 'limit');
    if (params.limit.amountMinor === 0) {
      throw new DomainError('limit must be greater than zero', 'INVALID_REINSURANCE_PARAMETER', {
        limit: params.limit,
      });
    }
  }
}

/** Quota share: a fixed proportion of the presented loss, capped per loss if configured. */
export function applyQuotaShare(loss: Money, params: QuotaShareParams): { ceded: Money; retained: Money } {
  const rawCeded = Math.round((loss.amountMinor * params.cededBps) / 10_000);
  const cap = params.perLossLimit?.amountMinor ?? Number.POSITIVE_INFINITY;
  const cededAmount = Math.min(rawCeded, cap);
  const ceded = money(cededAmount, loss.currency);
  return { ceded, retained: subtractMoney(loss, ceded) };
}

/** Excess of loss: the slice of a single loss between the attachment point and attachment + limit. */
export function applyExcessOfLoss(loss: Money, params: ExcessOfLossParams): { ceded: Money; retained: Money } {
  const excess = Math.max(0, loss.amountMinor - params.attachmentPoint.amountMinor);
  const ceded = money(Math.min(excess, params.limit.amountMinor), loss.currency);
  return { ceded, retained: subtractMoney(loss, ceded) };
}

/**
 * Aggregate protection: this loss cedes only the portion of the cumulative
 * total (prior losses processed by this layer, plus this one) that falls
 * between the attachment point and attachment + limit — i.e. the layer
 * "fills up" across many losses over a period, not per occurrence.
 */
export function applyAggregate(
  loss: Money,
  params: AggregateParams,
  state: ReinsuranceLayerState,
): { ceded: Money; retained: Money; nextState: ReinsuranceLayerState } {
  const before = state.consumedGross.amountMinor;
  const after = before + loss.amountMinor;
  const aboveBefore = Math.max(0, before - params.attachmentPoint.amountMinor);
  const aboveAfter = Math.max(0, after - params.attachmentPoint.amountMinor);
  const potentialCession = aboveAfter - aboveBefore;
  const remainingLimit = params.limit.amountMinor - state.consumedCeded.amountMinor;
  const cededAmount = Math.max(0, Math.min(potentialCession, remainingLimit));
  const ceded = money(cededAmount, loss.currency);

  return {
    ceded,
    retained: subtractMoney(loss, ceded),
    nextState: {
      consumedGross: money(after, loss.currency),
      consumedCeded: addMoney(state.consumedCeded, ceded),
    },
  };
}

/**
 * Applies a program's layers, in `order`, to a gross loss. Each layer
 * receives what the previous layer left retained — a defensible, stated
 * simplification (real placements do not always stack serially; a quota
 * share is often computed on gross premium/loss rather than the excess
 * layers' net retention), documented in docs/reports/phase-9.md rather than
 * modelled with more structure this system has no real placement data to
 * calibrate against.
 */
export function applyReinsuranceProgram(
  grossLoss: Money,
  layers: readonly ReinsuranceLayer[],
): ProgramCessionResult {
  if (grossLoss.amountMinor < 0) {
    throw new DomainError('grossLoss must not be negative', 'INVALID_REINSURANCE_PARAMETER', {
      grossLoss,
    });
  }

  const ordered = [...layers].sort((a, b) => a.order - b.order);
  const perLayer: LayerCessionResult[] = [];
  let remaining = grossLoss;

  for (const layer of ordered) {
    requireValidLayerParams(layer.params);

    if (layer.params.kind === 'QUOTA_SHARE') {
      const { ceded, retained } = applyQuotaShare(remaining, layer.params);
      perLayer.push({ layerId: layer.id, kind: 'QUOTA_SHARE', lossPresented: remaining, ceded, retained });
      remaining = retained;
    } else if (layer.params.kind === 'EXCESS_OF_LOSS') {
      const { ceded, retained } = applyExcessOfLoss(remaining, layer.params);
      perLayer.push({ layerId: layer.id, kind: 'EXCESS_OF_LOSS', lossPresented: remaining, ceded, retained });
      remaining = retained;
    } else {
      const state = layer.state ?? { consumedGross: money(0, grossLoss.currency), consumedCeded: money(0, grossLoss.currency) };
      const { ceded, retained, nextState } = applyAggregate(remaining, layer.params, state);
      perLayer.push({
        layerId: layer.id,
        kind: 'AGGREGATE',
        lossPresented: remaining,
        ceded,
        retained,
        nextState,
      });
      remaining = retained;
    }
  }

  const totalCeded = subtractMoney(grossLoss, remaining);
  return { grossLoss, perLayer, totalCeded, netRetained: remaining };
}

/** Convenience: true if a program's layers together cede the whole loss (fully reinsured). */
export function isFullyCeded(result: ProgramCessionResult): boolean {
  return compareMoney(result.netRetained, money(0, result.netRetained.currency)) === 0;
}
