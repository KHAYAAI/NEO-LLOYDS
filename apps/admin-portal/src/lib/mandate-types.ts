import type { AgentMandate } from '@neo-lloyds/domain';

/**
 * The shape GET /identity/mandates actually returns -- an AgentMandate
 * plus the bookkeeping/presentation fields the API layer adds
 * (apps/api/src/persistence/ports.ts's StoredMandate, plus the computed
 * status and resolved agent name IdentityService.listMandates adds on
 * top). Kept as a local, hand-matched copy across the API boundary, same
 * convention as apps/broker-portal/src/lib/types.ts's Listing.
 */
export interface MandateListItem extends AgentMandate {
  readonly createdAt: string;
  readonly revokedAt: string | null;
  readonly agentLegalName: string;
  readonly status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
}
