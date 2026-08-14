import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { auditRecord, type AuditContext } from './audit.types.js';
import {
  AUDIT_REPOSITORY,
  CLOCK,
  type AuditRepository,
  type Clock,
} from '../persistence/ports.js';

@Injectable()
export class AuditService {
  constructor(
    @Inject(AUDIT_REPOSITORY) private readonly repository: AuditRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Records a material action. Callers await this before returning success, so
   * a failure to audit fails the request (security-model.md §6).
   */
  async record(input: AuditContext): Promise<void> {
    await this.repository.append(
      auditRecord({ id: randomUUID(), at: this.clock.now(), ...input }),
    );
  }

  async list(filter: {
    organisationId?: string;
    subjectId?: string;
    limit: number;
  }) {
    return this.repository.list(filter);
  }
}
