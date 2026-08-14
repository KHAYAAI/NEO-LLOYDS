import type {
  AgentMandate,
  AuditRecord,
  CapitalAppetite,
  MarketRole,
  Organisation,
  RiskEdge,
  RiskNode,
  RiskSubmission,
  SubmissionStatus,
  UnderwritingApproval,
  UnderwritingAssessment,
} from '@neo-lloyds/domain';
import type {
  AuditRepository,
  Clock,
  GraphRepository,
  IdentityRepository,
  MarketplaceRepository,
  StoredCredential,
  StoredInterest,
  StoredListing,
  SubmissionRepository,
  UnderwritingRepository,
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

export class InMemorySubmissionRepository implements SubmissionRepository {
  private readonly submissions = new Map<string, RiskSubmission>();

  async create(submission: RiskSubmission): Promise<RiskSubmission> {
    this.submissions.set(submission.id, submission);
    return submission;
  }

  async advance(
    id: string,
    to: SubmissionStatus,
    updatedAt: Date,
  ): Promise<RiskSubmission | undefined> {
    const existing = this.submissions.get(id);
    if (!existing) return undefined;
    const updated: RiskSubmission = { ...existing, status: to, updatedAt: updatedAt.toISOString() };
    this.submissions.set(id, updated);
    return updated;
  }

  async find(id: string): Promise<RiskSubmission | undefined> {
    return this.submissions.get(id);
  }

  async listByOrganisation(organisationId: string): Promise<RiskSubmission[]> {
    return [...this.submissions.values()].filter((s) => s.organisationId === organisationId);
  }
}

export class InMemoryUnderwritingRepository implements UnderwritingRepository {
  private readonly assessments: (UnderwritingAssessment & { id: string; organisationId: string })[] = [];
  private readonly approvals: (UnderwritingApproval & { id: string; assessmentId: string })[] = [];

  async createAssessment(
    assessment: UnderwritingAssessment & { id: string; organisationId: string },
  ) {
    this.assessments.push(assessment);
    return assessment;
  }

  async latestAssessment(riskId: string) {
    const matches = this.assessments.filter((a) => a.riskId === riskId);
    return matches.at(-1);
  }

  async createApproval(approval: UnderwritingApproval & { id: string; assessmentId: string }) {
    this.approvals.push(approval);
    return approval;
  }

  async latestApproval(riskId: string): Promise<UnderwritingApproval | undefined> {
    const matches = this.approvals.filter((a) => a.riskId === riskId);
    return matches.at(-1);
  }
}

export class InMemoryMarketplaceRepository implements MarketplaceRepository {
  private readonly listings = new Map<string, StoredListing>();
  private readonly appetites = new Map<string, CapitalAppetite>();
  private readonly interests = new Map<string, StoredInterest[]>();

  async createListing(
    listing: Omit<StoredListing, 'status' | 'listedAt' | 'closedAt'>,
  ): Promise<StoredListing> {
    const stored: StoredListing = { ...listing, status: 'OPEN', listedAt: new Date(), closedAt: null };
    this.listings.set(stored.id, stored);
    return stored;
  }

  async findListing(id: string): Promise<StoredListing | undefined> {
    return this.listings.get(id);
  }

  async findListingBySubmission(submissionId: string): Promise<StoredListing | undefined> {
    return [...this.listings.values()].find((l) => l.submissionId === submissionId);
  }

  async listOpenListings(filter: { riskClass?: string; jurisdiction?: string }): Promise<StoredListing[]> {
    return [...this.listings.values()].filter(
      (l) =>
        l.status === 'OPEN' &&
        (!filter.riskClass || l.riskClass === filter.riskClass) &&
        (!filter.jurisdiction || l.jurisdiction === filter.jurisdiction),
    );
  }

  async setListingStatus(id: string, status: StoredListing['status'], closedAt?: Date): Promise<void> {
    const listing = this.listings.get(id);
    if (listing) {
      listing.status = status;
      if (closedAt) listing.closedAt = closedAt;
    }
  }

  async upsertAppetite(profile: CapitalAppetite): Promise<CapitalAppetite> {
    this.appetites.set(profile.organisationId, profile);
    return profile;
  }

  async findAppetite(organisationId: string): Promise<CapitalAppetite | undefined> {
    return this.appetites.get(organisationId);
  }

  async expressInterest(interest: Omit<StoredInterest, 'withdrawnAt'>): Promise<StoredInterest> {
    const stored: StoredInterest = { ...interest, withdrawnAt: null };
    const list = this.interests.get(interest.listingId) ?? [];
    const withoutExisting = list.filter((i) => i.organisationId !== interest.organisationId);
    this.interests.set(interest.listingId, [...withoutExisting, stored]);
    return stored;
  }

  async listInterests(listingId: string): Promise<StoredInterest[]> {
    return this.interests.get(listingId) ?? [];
  }

  async withdrawInterest(listingId: string, organisationId: string, at: Date): Promise<void> {
    const list = this.interests.get(listingId) ?? [];
    const updated = list.map((i) =>
      i.organisationId === organisationId ? { ...i, withdrawnAt: at } : i,
    );
    this.interests.set(listingId, updated);
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
