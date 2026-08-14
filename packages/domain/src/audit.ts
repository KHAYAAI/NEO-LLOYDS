import type { AuthContext } from './identity.js';
import { ONTOLOGY_VERSION } from './ontology.js';

/**
 * Append-only audit record. Every material action produces one, and the audit
 * write shares the transaction of the change it describes: if the audit fails,
 * the change fails (security-model.md §6).
 */
export interface AuditRecord {
  readonly id: string;
  readonly at: string;
  readonly actorOrganisationId: string;
  readonly actorSubjectId: string;
  readonly actorSubjectKind: string;
  readonly action: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly decision: 'ALLOWED' | 'DENIED';
  readonly reason: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly policy?: string;
  readonly modelId?: string;
  readonly modelVersion?: string;
  readonly ontologyVersion: string;
}

export interface AuditInput {
  id: string;
  at: Date;
  ctx: AuthContext;
  action: string;
  subjectType: string;
  subjectId: string;
  decision: 'ALLOWED' | 'DENIED';
  reason: string;
  before?: unknown;
  after?: unknown;
  policy?: string;
  modelId?: string;
  modelVersion?: string;
}

export function auditRecord(input: AuditInput): AuditRecord {
  return Object.freeze({
    id: input.id,
    at: input.at.toISOString(),
    actorOrganisationId: input.ctx.organisationId,
    actorSubjectId: input.ctx.subjectId,
    actorSubjectKind: input.ctx.subjectKind,
    action: input.action,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    decision: input.decision,
    reason: input.reason,
    before: input.before ?? null,
    after: input.after ?? null,
    ...(input.policy ? { policy: input.policy } : {}),
    ...(input.modelId ? { modelId: input.modelId } : {}),
    ...(input.modelVersion ? { modelVersion: input.modelVersion } : {}),
    ontologyVersion: ONTOLOGY_VERSION,
  });
}
