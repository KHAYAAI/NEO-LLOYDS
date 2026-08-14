import {
  DomainError,
  type Allocation,
  type AgentMandate,
  type AuditRecord,
  type CapitalAppetite,
  type MarketRole,
  type Money,
  type Organisation,
  type RiskEdge,
  type RiskNode,
  type RiskSubmission,
  type SubmissionStatus,
  type UnderwritingApproval,
  type UnderwritingAssessment,
} from '@neo-lloyds/domain';
import type {
  AllocationEvent,
  AuditRepository,
  CapitalRepository,
  Clock,
  GraphRepository,
  IdentityRepository,
  MarketplaceRepository,
  StoredCapitalCommitment,
  StoredCredential,
  StoredInterest,
  StoredListing,
  StoredSyndication,
  SubmissionRepository,
  SyndicationRepository,
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

export class InMemorySyndicationRepository implements SyndicationRepository {
  private readonly syndications = new Map<string, StoredSyndication>();
  private readonly allocations = new Map<string, (Allocation & { id: string })[]>();
  private readonly events = new Map<string, AllocationEvent[]>();

  async create(input: {
    id: string;
    listingId: string;
    organisationId: string;
    capacity: Money;
  }): Promise<StoredSyndication> {
    const syndication: StoredSyndication = {
      id: input.id,
      listingId: input.listingId,
      organisationId: input.organisationId,
      capacity: input.capacity,
      status: 'OPEN',
      createdAt: new Date(),
      boundAt: null,
    };
    this.syndications.set(syndication.id, syndication);
    this.allocations.set(syndication.id, []);
    this.events.set(syndication.id, []);
    return syndication;
  }

  async find(id: string): Promise<StoredSyndication | undefined> {
    return this.syndications.get(id);
  }

  async findByListing(listingId: string): Promise<StoredSyndication | undefined> {
    return [...this.syndications.values()].find((s) => s.listingId === listingId);
  }

  async addAllocation(
    syndicationId: string,
    allocation: Allocation & { id: string },
    actorSubjectId: string,
  ): Promise<void> {
    const syndication = this.syndications.get(syndicationId);
    if (syndication?.status !== 'OPEN') {
      throw new DomainError('Cannot mutate allocations on a non-OPEN syndication', 'SYNDICATION_NOT_OPEN', {
        syndicationId,
      });
    }
    const list = this.allocations.get(syndicationId) ?? [];
    this.allocations.set(syndicationId, [...list, allocation]);
    this.appendEvent(syndicationId, {
      id: `${allocation.id}-proposed`,
      syndicationId,
      organisationId: allocation.organisationId,
      action: 'PROPOSED',
      shareBps: allocation.shareBps,
      amount: allocation.amount,
      actorSubjectId,
      recordedAt: new Date(),
    });
  }

  async removeAllocation(
    syndicationId: string,
    organisationId: string,
    actorSubjectId: string,
  ): Promise<void> {
    const syndication = this.syndications.get(syndicationId);
    if (syndication?.status !== 'OPEN') {
      throw new DomainError('Cannot mutate allocations on a non-OPEN syndication', 'SYNDICATION_NOT_OPEN', {
        syndicationId,
      });
    }
    const list = this.allocations.get(syndicationId) ?? [];
    const removed = list.find((a) => a.organisationId === organisationId);
    this.allocations.set(
      syndicationId,
      list.filter((a) => a.organisationId !== organisationId),
    );
    if (removed) {
      this.appendEvent(syndicationId, {
        id: `${removed.id}-removed-${Date.now()}`,
        syndicationId,
        organisationId,
        action: 'REMOVED',
        shareBps: removed.shareBps,
        amount: removed.amount,
        actorSubjectId,
        recordedAt: new Date(),
      });
    }
  }

  async listAllocations(syndicationId: string): Promise<Allocation[]> {
    return this.allocations.get(syndicationId) ?? [];
  }

  async bind(
    syndicationId: string,
    finalAllocations: readonly Allocation[],
    actorSubjectId: string,
    boundAt: Date,
  ): Promise<StoredSyndication> {
    const syndication = this.syndications.get(syndicationId);
    if (!syndication) throw new DomainError('Syndication not found', 'NOT_FOUND', { syndicationId });

    const withIds = finalAllocations.map((a, i) => ({
      ...a,
      id: this.allocations.get(syndicationId)?.[i]?.id ?? `${syndicationId}-final-${i}`,
    }));
    this.allocations.set(syndicationId, withIds);

    for (const allocation of finalAllocations) {
      this.appendEvent(syndicationId, {
        id: `${syndicationId}-${allocation.organisationId}-bound`,
        syndicationId,
        organisationId: allocation.organisationId,
        action: 'BOUND',
        shareBps: allocation.shareBps,
        amount: allocation.amount,
        actorSubjectId,
        recordedAt: boundAt,
      });
    }

    const bound: StoredSyndication = { ...syndication, status: 'BOUND', boundAt };
    this.syndications.set(syndicationId, bound);
    return bound;
  }

  async listEvents(syndicationId: string): Promise<AllocationEvent[]> {
    return this.events.get(syndicationId) ?? [];
  }

  async listAllocationsForOrganisation(
    organisationId: string,
  ): Promise<{ syndicationId: string; status: 'OPEN' | 'BOUND' | 'CANCELLED'; listingId: string; amount: Money }[]> {
    const result: { syndicationId: string; status: 'OPEN' | 'BOUND' | 'CANCELLED'; listingId: string; amount: Money }[] = [];
    for (const [syndicationId, allocations] of this.allocations.entries()) {
      const syndication = this.syndications.get(syndicationId);
      if (!syndication) continue;
      for (const allocation of allocations) {
        if (allocation.organisationId === organisationId) {
          result.push({
            syndicationId,
            status: syndication.status,
            listingId: syndication.listingId,
            amount: allocation.amount,
          });
        }
      }
    }
    return result;
  }

  private appendEvent(syndicationId: string, event: AllocationEvent): void {
    const list = this.events.get(syndicationId) ?? [];
    this.events.set(syndicationId, [...list, event]);
  }
}

export class InMemoryCapitalRepository implements CapitalRepository {
  private readonly commitments = new Map<string, StoredCapitalCommitment>();

  async upsertCommitment(organisationId: string, committed: Money): Promise<StoredCapitalCommitment> {
    const commitment: StoredCapitalCommitment = { organisationId, committed, updatedAt: new Date() };
    this.commitments.set(organisationId, commitment);
    return commitment;
  }

  async findCommitment(organisationId: string): Promise<StoredCapitalCommitment | undefined> {
    return this.commitments.get(organisationId);
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
