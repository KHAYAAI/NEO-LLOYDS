import type {
  AgentMandate,
  AuditRecord,
  MarketRole,
  Organisation,
  RiskEdge,
  RiskNode,
} from '@neo-lloyds/domain';

/**
 * Persistence ports. The API depends on these interfaces, never on Prisma
 * directly, which is what lets the same controllers run against PostgreSQL in
 * production and an in-memory store in tests (ADR-0001).
 */

export interface StoredCredential {
  id: string;
  keyId: string;
  secretHash: string;
  secretSalt: string;
  organisationId: string;
  label: string;
  scopes: string[];
  subjectKind: 'USER' | 'SERVICE' | 'AGENT';
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export interface IdentityRepository {
  createOrganisation(input: {
    id: string;
    legalName: string;
    kind: Organisation['kind'];
    jurisdiction: string;
    principalOrganisationId?: string;
  }): Promise<Organisation>;

  findOrganisation(id: string): Promise<Organisation | undefined>;
  listOrganisations(): Promise<Organisation[]>;
  grantRole(organisationId: string, role: MarketRole, grantedBy: string): Promise<Organisation>;
  setKybStatus(organisationId: string, status: Organisation['kybStatus']): Promise<Organisation>;

  createCredential(input: Omit<StoredCredential, 'revokedAt'>): Promise<StoredCredential>;
  findCredentialByKeyId(keyId: string): Promise<StoredCredential | undefined>;
  revokeCredential(keyId: string): Promise<void>;

  createMandate(mandate: AgentMandate & { id: string }): Promise<AgentMandate>;
  findActiveMandate(agentOrganisationId: string): Promise<AgentMandate | undefined>;
}

export interface AuditRepository {
  append(record: AuditRecord): Promise<void>;
  list(filter: {
    organisationId?: string;
    subjectId?: string;
    limit: number;
  }): Promise<AuditRecord[]>;
}

export interface GraphRepository {
  createNode(node: RiskNode): Promise<RiskNode>;
  createEdge(edge: RiskEdge): Promise<RiskEdge>;
  findNode(id: string): Promise<RiskNode | undefined>;
  /**
   * Loads the subgraph an organisation may traverse. Phase 1 loads the
   * organisation's whole graph; ADR-0003 records when this becomes a bounded
   * recursive CTE instead.
   */
  loadSubgraph(organisationId: string): Promise<{ nodes: RiskNode[]; edges: RiskEdge[] }>;
}

export const IDENTITY_REPOSITORY = Symbol('IDENTITY_REPOSITORY');
export const AUDIT_REPOSITORY = Symbol('AUDIT_REPOSITORY');
export const GRAPH_REPOSITORY = Symbol('GRAPH_REPOSITORY');
export const CLOCK = Symbol('CLOCK');

export interface Clock {
  now(): Date;
}
