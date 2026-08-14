import { DomainError } from './errors.js';
import type { Confidence } from './uncertainty.js';
import { confidence } from './uncertainty.js';

/**
 * The AI Risk Analyst contract (brief §6). This module defines only the
 * *shape* every analyst output must take — it contains no model calls. The
 * invariant this file exists to enforce: an AI conclusion that does not name
 * its model, its version, and the source data it read is not a valid
 * AnalystFinding and cannot be constructed (ADR-0006).
 */

export type FindingKind =
  | 'SUMMARY'
  | 'DEPENDENCY'
  | 'MISSING_INFORMATION'
  | 'CONFLICTING_INFORMATION'
  | 'PROPOSED_FACTOR'
  | 'UNDERWRITING_QUESTION'
  | 'ANOMALY';

export interface AnalystFinding {
  readonly kind: FindingKind;
  readonly statement: string;
  readonly confidence: Confidence;
  /** Ids of the graph nodes / documents this finding is grounded in. Required. */
  readonly referencedData: readonly string[];
  readonly modelId: string;
  readonly modelVersion: string;
  readonly generatedAt: string;
}

export interface AnalystFindingInput {
  kind: FindingKind;
  statement: string;
  confidence: number;
  referencedData: readonly string[];
  modelId: string;
  modelVersion: string;
  generatedAt: string;
}

/**
 * Constructs a finding, rejecting anything ungrounded. This is the one and
 * only way to produce an AnalystFinding, so "the AI must never silently
 * fabricate data" is a compile-time and run-time property, not a prompt
 * instruction.
 */
export function analystFinding(input: AnalystFindingInput): AnalystFinding {
  if (!input.statement || input.statement.trim() === '') {
    throw new DomainError('An analyst finding must state a claim', 'EMPTY_FINDING');
  }
  if (input.referencedData.length === 0) {
    throw new DomainError(
      'An analyst finding must reference the source data it is grounded in',
      'UNGROUNDED_FINDING',
      { statement: input.statement },
    );
  }
  if (!input.modelId || !input.modelVersion) {
    throw new DomainError(
      'An analyst finding must name its model and model version',
      'UNATTRIBUTED_FINDING',
    );
  }

  return Object.freeze({
    kind: input.kind,
    statement: input.statement,
    confidence: confidence(input.confidence),
    referencedData: Object.freeze([...input.referencedData]),
    modelId: input.modelId,
    modelVersion: input.modelVersion,
    generatedAt: input.generatedAt,
  });
}

export interface AnalystReport {
  readonly riskId: string;
  readonly findings: readonly AnalystFinding[];
  readonly modelId: string;
  readonly modelVersion: string;
  readonly generatedAt: string;
  /** True when the provider could not run (no key configured, timeout, etc). */
  readonly degraded: boolean;
}

/**
 * The provider port. Concrete adapters (Anthropic, OpenAI, a null provider)
 * implement this; nothing above this line depends on which one is wired in.
 * The analyst is advisory by construction: this interface has no method that
 * binds, approves, or executes anything — only `analyse`.
 */
export interface AnalystProvider {
  readonly modelId: string;
  readonly modelVersion: string;
  analyse(input: {
    riskId: string;
    riskLabel: string;
    graphSummary: string;
    knownFactors: readonly string[];
  }): Promise<readonly AnalystFindingInput[]>;
}
