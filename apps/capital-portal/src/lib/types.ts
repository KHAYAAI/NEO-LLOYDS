import type { Money } from '@neo-lloyds/domain';

/**
 * Response shapes that exist only at the API layer
 * (`apps/api/src/persistence/ports.ts`), not in `@neo-lloyds/domain` — kept
 * as a hand-matched local copy rather than reaching into `apps/api`
 * internals across an app boundary. Same convention as the broker portal
 * (`apps/broker-portal/src/lib/types.ts`).
 */
export interface Listing {
  readonly id: string;
  readonly organisationId: string;
  readonly submissionId: string;
  readonly riskId: string;
  readonly title: string;
  readonly riskClass: string;
  readonly jurisdiction: string;
  readonly capacity: Money;
  readonly status: 'OPEN' | 'MATCHED' | 'WITHDRAWN' | 'EXPIRED';
  readonly durationDays: number;
  readonly listedAt: string;
  readonly closedAt: string | null;
}

export interface Interest {
  readonly listingId: string;
  readonly organisationId: string;
  readonly indicativeAmount: Money;
  readonly note: string | null;
  readonly expressedAt: string;
}
