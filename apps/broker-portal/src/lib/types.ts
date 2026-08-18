import type { Money } from '@neo-lloyds/domain';

/**
 * Response shapes that exist only at the API layer (`apps/api/src/persistence/ports.ts`),
 * not in `@neo-lloyds/domain` — the domain package stays free of persistence
 * concerns, so this portal keeps its own minimal, hand-matched copies rather
 * than reaching into `apps/api` internals across an app boundary.
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
