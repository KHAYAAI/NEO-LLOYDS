import { auditRecord as buildAuditRecord, type AuditInput } from '@neo-lloyds/domain';

/** The parts of an audit record a caller supplies; id and time are added centrally. */
export type AuditContext = Omit<AuditInput, 'id' | 'at'>;

export const auditRecord = buildAuditRecord;
