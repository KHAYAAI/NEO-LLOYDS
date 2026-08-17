import { DomainError } from './errors.js';
import type { RiskGraph, RiskNode } from './graph.js';
import type { Money } from './money.js';
import { sumMoney } from './money.js';
import {
  capitalBearingRisk,
  correlatedEntities,
  coveringPolicies,
  dependentsOf,
  exposedEntities,
} from './queries.js';
import { estimate, type Estimate } from './uncertainty.js';

/**
 * Simulation & Digital Twin (roadmap Phase 8). Every prior phase processes
 * something that already happened — a submission, a claim. This is the first
 * phase that runs *forward* from the risk graph: "what would this event do
 * to what's insured here" rather than "here is what happened, adjudicate
 * it." Deliberately built entirely on Phase 1's traversal queries
 * (`queries.ts`) rather than a second graph-walking implementation, so a
 * simulation can never disagree with the graph about what depends on what.
 */

export const SIMULATION_SCENARIO_KINDS = [
  'PORT_CLOSURE',
  'SUPPLY_CHAIN_DISRUPTION',
  'COMMODITY_SHOCK',
  'WEATHER',
  'INFRASTRUCTURE_FAILURE',
  'COUNTERPARTY_FAILURE',
  'GEOPOLITICAL',
  'CYBER',
] as const;

export type SimulationScenarioKind = (typeof SIMULATION_SCENARIO_KINDS)[number];

export function isSimulationScenarioKind(value: string): value is SimulationScenarioKind {
  return (SIMULATION_SCENARIO_KINDS as readonly string[]).includes(value);
}

/**
 * Every scenario parameter is an explicit input, never a hidden default: the
 * whole point of a "what if" tool is that the "if" is stated, not assumed.
 * `durationDays` and `severity` shape the loss model in {@link estimateLoss}
 * and both flow back out into the output's basis string so a reader never
 * has to guess what was assumed.
 */
export interface SimulationScenario {
  readonly kind: SimulationScenarioKind;
  /** The node (ASSET or ENTITY) the scenario originates at. */
  readonly triggerNodeId: string;
  /** How long the disruption lasts. Purely an input to the loss model. */
  readonly durationDays: number;
  /** Severity in [0,1]: 0 = negligible, 1 = total loss of the trigger node's function. */
  readonly severity: number;
  /** Free-text scenario description for audit/display; not interpreted. */
  readonly description?: string;
}

export function requireValidScenario(scenario: SimulationScenario): void {
  if (!isSimulationScenarioKind(scenario.kind)) {
    throw new DomainError('Unknown simulation scenario kind', 'UNKNOWN_SCENARIO_KIND', {
      kind: scenario.kind,
    });
  }
  if (!Number.isFinite(scenario.durationDays) || scenario.durationDays <= 0) {
    throw new DomainError('durationDays must be a positive, finite number', 'INVALID_SCENARIO_PARAMETER', {
      durationDays: scenario.durationDays,
    });
  }
  if (!Number.isFinite(scenario.severity) || scenario.severity < 0 || scenario.severity > 1) {
    throw new DomainError('severity must be in [0,1]', 'INVALID_SCENARIO_PARAMETER', {
      severity: scenario.severity,
    });
  }
}

export interface InsuranceSplit {
  readonly insuredEntities: readonly RiskNode[];
  readonly uninsuredEntities: readonly RiskNode[];
}

export interface SimulationResult {
  readonly scenario: SimulationScenario;
  readonly triggerNode: RiskNode;
  /** Assets reachable from the trigger node via DEPENDS_ON (reverse direction: what fails as a result). */
  readonly affectedAssets: readonly RiskNode[];
  /** Entities exposed as a result — owners of affected assets, plus anyone directly EXPOSED_TO the trigger if it is a RISK-adjacent node. */
  readonly exposedEntities: readonly RiskNode[];
  /**
   * A single naive loss figure, deliberately low-confidence. This is NOT an
   * actuarial model: it has no frequency/severity curve, no historical loss
   * data, no peril-specific damage function. It exists so the platform never
   * returns "no number" for a forward-looking scenario, while being honest,
   * via `basis`/`confidence`, that the number is a rough order-of-magnitude
   * placeholder, not a priced estimate. See `estimateLoss` doc comment.
   */
  readonly estimatedLoss: Estimate & { readonly currency: string };
  /** Q7 reused: entities that share a dependency with the trigger, i.e. would fail alongside it. */
  readonly correlatedExposure: ReturnType<typeof correlatedEntities>;
  /** Capital currently bearing the risks connected to the affected assets/exposed entities, via ASSUMES/SUPPORTS/PROTECTS. */
  readonly capitalRequirement: ReturnType<typeof capitalBearingRisk>;
  readonly insuredVsUninsured: InsuranceSplit;
}

const SCENARIO_SEVERITY_WEIGHT: Readonly<Record<SimulationScenarioKind, number>> = {
  // Purely illustrative relative weights between scenario kinds — not
  // calibrated against any loss history (see docs/reports/phase-8.md).
  // A cyber or counterparty failure tends to cascade faster per asset than a
  // weather event affecting a single site, so the placeholder weights differ,
  // but neither is derived from real data and both must be read as such.
  PORT_CLOSURE: 1.0,
  SUPPLY_CHAIN_DISRUPTION: 1.1,
  COMMODITY_SHOCK: 0.8,
  WEATHER: 0.9,
  INFRASTRUCTURE_FAILURE: 1.2,
  COUNTERPARTY_FAILURE: 1.3,
  GEOPOLITICAL: 1.0,
  CYBER: 1.4,
};

/** A per-asset placeholder magnitude, in minor units, before scenario weighting. Arbitrary but explicit — see doc comment on `estimateLoss`. */
const BASE_LOSS_PER_ASSET_MINOR = 10_000_00; // $10,000 equivalent, in whatever currency is supplied

/**
 * THE HONESTY POINT of this phase. There is no actuarial model behind this
 * number: no peril-specific damage function, no historical claims data, no
 * dependency-weighted cascading-failure simulation. It is
 * `(placeholder per-asset magnitude) x (affected asset count) x (severity) x
 * (scenario weight) x (duration dampening)` — a rough, deliberately
 * transparent order-of-magnitude figure, not a priced estimate. Confidence is
 * pinned low (0.2) regardless of inputs, and `basis` is always
 * `INSUFFICIENT_DATA`: no combination of scenario parameters should ever be
 * allowed to present this as more certain than it is. A real implementation
 * needs calibrated peril models per asset class/jurisdiction — flagged as a
 * gap, not worked around with fabricated confidence.
 */
export function estimateLoss(
  scenario: SimulationScenario,
  affectedAssetCount: number,
  currency: string,
): Estimate & { readonly currency: string } {
  const weight = SCENARIO_SEVERITY_WEIGHT[scenario.kind];
  // Duration dampens per-day marginal impact rather than scaling linearly
  // forever — a disruption does not do 365x the damage at 365 days versus 1 —
  // but this curve shape is itself a judgement call, not derived data.
  const durationFactor = Math.log2(1 + scenario.durationDays);
  const magnitude = Math.round(
    BASE_LOSS_PER_ASSET_MINOR * affectedAssetCount * scenario.severity * weight * durationFactor,
  );
  return {
    ...estimate(magnitude, 0.2, 'INSUFFICIENT_DATA'),
    currency,
  };
}

/**
 * Runs a scenario forward from the risk graph. Pure and read-only: nothing
 * here mutates the graph or persists anything, exactly the same discipline
 * as every other domain function — persistence of a run is an API-layer
 * concern (see `apps/api/src/simulation`).
 */
export function runSimulation(
  graph: RiskGraph,
  scenario: SimulationScenario,
  currency: string,
): SimulationResult {
  requireValidScenario(scenario);
  const triggerNode = graph.requireNode(scenario.triggerNodeId);

  // Affected assets: what fails downstream of the trigger. If the trigger is
  // itself an asset, `dependentsOf` walks DEPENDS_ON in reverse to find
  // everything that depends on it. If the trigger is an entity, we treat its
  // owned assets (and their dependents) as affected — reusing `whatCanFail`'s
  // OWNS traversal indirectly via `exposedEntities`'s asset resolution below
  // would duplicate logic, so entities are resolved by first finding assets
  // they own directly connected via DEPENDS_ON is out of scope for a bare
  // ENTITY trigger; only ASSET/RISK-adjacent triggers produce affected assets.
  const affectedAssets =
    triggerNode.type === 'ASSET'
      ? dependentsOf(graph, triggerNode.id).map((d) => d.node)
      : [];

  // Exposed entities: owners of every affected asset (self included if the
  // trigger asset itself is owned), deduplicated. If the trigger is a RISK
  // node, Q3 (`exposedEntities`) already answers this directly and is reused
  // instead.
  const exposed = new Map<string, RiskNode>();
  if (triggerNode.type === 'RISK') {
    for (const entity of exposedEntities(graph, triggerNode.id)) exposed.set(entity.id, entity);
  } else {
    const assetIds = new Set([triggerNode.id, ...affectedAssets.map((a) => a.id)]);
    for (const assetId of assetIds) {
      for (const ownership of graph.edgesTo(assetId, 'OWNS')) {
        const owner = graph.requireNode(ownership.fromId);
        exposed.set(owner.id, owner);
      }
    }
  }
  const exposedList = [...exposed.values()].sort((a, b) => a.id.localeCompare(b.id));

  const estimatedLoss = estimateLoss(scenario, affectedAssets.length, currency);

  // Correlated exposure only applies to ENTITY subjects (Q7's contract);
  // computed per exposed entity and merged, since the scenario may expose
  // several entities at once, not one subject the way Q7 is normally called.
  const correlatedByEntity = new Map<string, { entity: RiskNode; sharedDependencies: readonly RiskNode[] }>();
  for (const entity of exposedList) {
    for (const correlation of correlatedEntities(graph, entity.id)) {
      const existing = correlatedByEntity.get(correlation.entity.id);
      if (!existing || correlation.sharedDependencies.length > existing.sharedDependencies.length) {
        correlatedByEntity.set(correlation.entity.id, correlation);
      }
    }
  }
  const correlatedExposure = [...correlatedByEntity.values()].sort(
    (a, b) =>
      b.sharedDependencies.length - a.sharedDependencies.length ||
      a.entity.id.localeCompare(b.entity.id),
  );

  // Which RISK nodes this scenario is actually in scope of: the trigger
  // itself if it is a RISK, otherwise every RISK any affected asset (or the
  // trigger asset) is directly EXPOSED_TO. Both capital requirement and the
  // insured/uninsured split are computed per relevant risk and merged, since
  // a scenario can legitimately touch more than one.
  const relevantRiskIds = new Set<string>();
  if (triggerNode.type === 'RISK') {
    relevantRiskIds.add(triggerNode.id);
  } else {
    for (const assetId of [triggerNode.id, ...affectedAssets.map((a) => a.id)]) {
      for (const exposure of graph.edgesFrom(assetId, 'EXPOSED_TO')) {
        relevantRiskIds.add(exposure.toId);
      }
    }
  }

  const capitalByRisk = new Map<string, ReturnType<typeof capitalBearingRisk>[number]>();
  const coveredEntityIds = new Set<string>();
  for (const riskId of relevantRiskIds) {
    for (const entry of capitalBearingRisk(graph, riskId)) capitalByRisk.set(entry.syndicate.id, entry);
    for (const id of coveredEntityIdsForRisk(graph, riskId)) coveredEntityIds.add(id);
  }
  const capitalRequirement = [...capitalByRisk.values()].sort((a, b) => a.syndicate.id.localeCompare(b.syndicate.id));

  const insured: RiskNode[] = [];
  const uninsured: RiskNode[] = [];
  for (const entity of exposedList) {
    if (coveredEntityIds.has(entity.id)) insured.push(entity);
    else uninsured.push(entity);
  }

  return {
    scenario,
    triggerNode,
    affectedAssets,
    exposedEntities: exposedList,
    estimatedLoss,
    correlatedExposure,
    capitalRequirement,
    insuredVsUninsured: { insuredEntities: insured, uninsuredEntities: uninsured },
  };
}

/**
 * Given a RISK id, resolves which entities count as "insured" for the
 * insured-vs-uninsured split. A REAL GAP, stated plainly: the ontology
 * (`ontology.ts`) has no edge connecting a POLICY/COVERAGE node to the
 * specific ENTITY it insures — COVERS only reaches from POLICY to RISK, and
 * WRITES/holds-a-policy is not a modelled relationship yet. So the best this
 * function can honestly do is risk-level, not entity-level: if any policy or
 * coverage exists that COVERS this risk (Q5, `coveringPolicies`), every
 * entity exposed to that risk is treated as insured; otherwise none are.
 * This will over-count insurance whenever a policy exists but does not
 * actually name every exposed entity as a policyholder — flagged in
 * docs/reports/phase-8.md rather than worked around with a fabricated
 * per-entity link the graph does not actually carry.
 */
export function coveredEntityIdsForRisk(graph: RiskGraph, riskId: string): ReadonlySet<string> {
  const hasCoverage = coveringPolicies(graph, riskId).length > 0;
  if (!hasCoverage) return new Set();
  return new Set(exposedEntities(graph, riskId).map((entity) => entity.id));
}

/** Total estimated loss across a currency, summing what would otherwise be several separate estimates — used for reporting only, not persisted separately. */
export function sumEstimatedLosses(estimates: readonly (Estimate & { currency: string })[], currency: string): Money {
  return sumMoney(
    estimates.map((e) => ({ amountMinor: Math.round(e.expected), currency: e.currency })),
    currency,
  );
}
