import type {
  AgentMandate,
  AuditRecord,
  MarketRole,
  Organisation,
  RiskEdge,
  RiskNode,
} from '@neo-lloyds/domain';
import type {
  AuditRepository,
  Clock,
  GraphRepository,
  IdentityRepository,
  StoredCredential,
} from './ports.js';

/**
 * In-memory adapters. Used by the test suite so that controller, guard and
 * audit behaviour can be exercised without a database — the domain rules being
 * tested are identical either way.
 */

export class InMemoryIdentityRepository implements IdentityRepository {
  private readonly organisations = new Map<string, Organisation>();
  private readonly credentials = new Map<string, StoredCredential>();
  private readonly mandates = new Map<string, AgentMandate>();

  async createOrganisation(input: {
    id: string;
    legalName: string;
    kind: Organisation['kind'];
    jurisdiction: string;
    principalOrganisationId?: string;
  }): Promise<Organisation> {
    const org: Organisation = {
      id: input.id,
      legalName: input.legalName,
      kind: input.kind,
      jurisdiction: input.jurisdiction,
      kybStatus: 'UNVERIFIED',
      roles: [],
      active: true,
      ...(input.principalOrganisationId
        ? { principalOrganisationId: input.principalOrganisationId }
        : {}),
    };
    this.organisations.set(org.id, org);
    return org;
  }

  async findOrganisation(id: string): Promise<Organisation | undefined> {
    return this.organisations.get(id);
  }

  async listOrganisations(): Promise<Organisation[]> {
    return [...this.organisations.values()];
  }

  async grantRole(organisationId: string, role: MarketRole): Promise<Organisation> {
    const org = this.organisations.get(organisationId);
    if (!org) throw new Error(`Unknown organisation: ${organisationId}`);
    const updated: Organisation = org.roles.includes(role)
      ? org
      : { ...org, roles: [...org.roles, role] };
    this.organisations.set(organisationId, updated);
    return updated;
  }

  async setKybStatus(
    organisationId: string,
    kybStatus: Organisation['kybStatus'],
  ): Promise<Organisation> {
    const org = this.organisations.get(organisationId);
    if (!org) throw new Error(`Unknown organisation: ${organisationId}`);
    const updated = { ...org, kybStatus };
    this.organisations.set(organisationId, updated);
    return updated;
  }

  async createCredential(
    input: Omit<StoredCredential, 'revokedAt'>,
  ): Promise<StoredCredential> {
    const credential: StoredCredential = { ...input, revokedAt: null };
    this.credentials.set(credential.keyId, credential);
    return credential;
  }

  async findCredentialByKeyId(keyId: string): Promise<StoredCredential | undefined> {
    return this.credentials.get(keyId);
  }

  async revokeCredential(keyId: string): Promise<void> {
    const credential = this.credentials.get(keyId);
    if (credential) credential.revokedAt = new Date();
  }

  async createMandate(mandate: AgentMandate & { id: string }): Promise<AgentMandate> {
    this.mandates.set(mandate.agentOrganisationId, mandate);
    return mandate;
  }

  async findActiveMandate(agentOrganisationId: string): Promise<AgentMandate | undefined> {
    return this.mandates.get(agentOrganisationId);
  }
}

export class InMemoryAuditRepository implements AuditRepository {
  readonly records: AuditRecord[] = [];

  async append(record: AuditRecord): Promise<void> {
    this.records.push(record);
  }

  async list(filter: {
    organisationId?: string;
    subjectId?: string;
    limit: number;
  }): Promise<AuditRecord[]> {
    return this.records
      .filter(
        (r) =>
          (!filter.organisationId || r.actorOrganisationId === filter.organisationId) &&
          (!filter.subjectId || r.subjectId === filter.subjectId),
      )
      .slice(-filter.limit)
      .reverse();
  }
}

export class InMemoryGraphRepository implements GraphRepository {
  private readonly nodes = new Map<string, RiskNode>();
  private readonly edges = new Map<string, RiskEdge>();

  async createNode(node: RiskNode): Promise<RiskNode> {
    this.nodes.set(node.id, node);
    return node;
  }

  async createEdge(edge: RiskEdge): Promise<RiskEdge> {
    this.edges.set(edge.id, edge);
    return edge;
  }

  async findNode(id: string): Promise<RiskNode | undefined> {
    return this.nodes.get(id);
  }

  async loadSubgraph(
    organisationId: string,
  ): Promise<{ nodes: RiskNode[]; edges: RiskEdge[] }> {
    const nodes = [...this.nodes.values()].filter(
      (n) => n.organisationId === organisationId,
    );
    const ids = new Set(nodes.map((n) => n.id));
    const edges = [...this.edges.values()].filter(
      (e) => ids.has(e.fromId) && ids.has(e.toId),
    );
    return { nodes, edges };
  }
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FixedClock implements Clock {
  constructor(private readonly at: Date) {}
  now(): Date {
    return this.at;
  }
}
