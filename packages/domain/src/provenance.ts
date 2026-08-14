import { ProvenanceError } from './errors.js';
import { confidence, type Confidence } from './uncertainty.js';

/**
 * Where a fact came from. `AI_INFERRED` is deliberately separate from every
 * other kind: it is a *claim*, never a verified fact (ADR-0006).
 */
export type SourceKind =
  | 'USER_DECLARED'
  | 'DOCUMENT'
  | 'EXTERNAL_FEED'
  | 'SENSOR'
  | 'DERIVED'
  | 'AI_INFERRED';

/** A single step in how raw source data became the value being stored. */
export interface Transformation {
  readonly step: string;
  readonly at: string;
  readonly by: string;
}

/**
 * Attached to every node and edge in the risk graph. There is no way to
 * express a fact without provenance, which is the point.
 */
export interface Provenance {
  readonly sourceId: string;
  readonly sourceKind: SourceKind;
  /** When the fact was true in the world (ISO-8601). */
  readonly observedAt: string;
  /** When Neo-Lloyds recorded it (ISO-8601). */
  readonly recordedAt: string;
  readonly confidence: Confidence;
  readonly transformations: readonly Transformation[];
  /** Required when sourceKind is AI_INFERRED. */
  readonly modelId?: string;
  readonly modelVersion?: string;
  /** Ids of the source data the model was shown. Required for AI_INFERRED. */
  readonly referencedData?: readonly string[];
}

const ISO_8601 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

function assertTimestamp(value: string, field: string): void {
  if (!ISO_8601.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ProvenanceError(`${field} must be an ISO-8601 timestamp`, {
      field,
      value,
    });
  }
}

export interface ProvenanceInput {
  sourceId: string;
  sourceKind: SourceKind;
  observedAt: string;
  recordedAt: string;
  confidence: number;
  transformations?: readonly Transformation[];
  modelId?: string;
  modelVersion?: string;
  referencedData?: readonly string[];
}

/**
 * Validates and freezes provenance. An AI-inferred value without a model id,
 * model version and referenced source data is rejected outright — this is the
 * enforcement point for "never fabricate silently".
 */
export function provenance(input: ProvenanceInput): Provenance {
  if (!input.sourceId || input.sourceId.trim() === '') {
    throw new ProvenanceError('sourceId is required', {});
  }
  assertTimestamp(input.observedAt, 'observedAt');
  assertTimestamp(input.recordedAt, 'recordedAt');

  if (Date.parse(input.observedAt) > Date.parse(input.recordedAt)) {
    throw new ProvenanceError('observedAt cannot be after recordedAt', {
      observedAt: input.observedAt,
      recordedAt: input.recordedAt,
    });
  }

  if (input.sourceKind === 'AI_INFERRED') {
    if (!input.modelId || !input.modelVersion) {
      throw new ProvenanceError(
        'AI_INFERRED provenance requires modelId and modelVersion',
        { sourceId: input.sourceId },
      );
    }
    if (!input.referencedData || input.referencedData.length === 0) {
      throw new ProvenanceError(
        'AI_INFERRED provenance requires the source data the model referenced',
        { sourceId: input.sourceId },
      );
    }
  }

  return Object.freeze({
    sourceId: input.sourceId,
    sourceKind: input.sourceKind,
    observedAt: input.observedAt,
    recordedAt: input.recordedAt,
    confidence: confidence(input.confidence),
    transformations: Object.freeze([...(input.transformations ?? [])]),
    ...(input.modelId ? { modelId: input.modelId } : {}),
    ...(input.modelVersion ? { modelVersion: input.modelVersion } : {}),
    ...(input.referencedData
      ? { referencedData: Object.freeze([...input.referencedData]) }
      : {}),
  });
}

/** True when the value may be relied on without a human verification step. */
export function isVerifiedSource(p: Provenance): boolean {
  return p.sourceKind !== 'AI_INFERRED';
}

/** Record a further transformation, preserving the full history. */
export function withTransformation(
  p: Provenance,
  step: Transformation,
): Provenance {
  return Object.freeze({ ...p, transformations: [...p.transformations, step] });
}
