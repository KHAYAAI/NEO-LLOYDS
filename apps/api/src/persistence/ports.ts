import type {
  AgentMandate,
  Allocation,
  AuditRecord,
  CapitalAppetite,
  MarketRole,
  Money,
  Organisation,
  RiskEdge,
  RiskNode,
  RiskSubmission,
  SubmissionStatus,
  UnderwritingApproval,
  UnderwritingAssessment,
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

export interface SubmissionRepository {
  create(submission: RiskSubmission): Promise<RiskSubmission>;
  advance(id: string, to: SubmissionStatus, updatedAt: Date): Promise<RiskSubmission | undefined>;
  find(id: string): Promise<RiskSubmission | undefined>;
  listByOrganisation(organisationId: string): Promise<RiskSubmission[]>;
}

export interface UnderwritingRepository {
  createAssessment(
    assessment: UnderwritingAssessment & { id: string; organisationId: string },
  ): Promise<UnderwritingAssessment & { id: string }>;
  /** Most recent assessment recorded for a risk, if any. */
  latestAssessment(
    riskId: string,
  ): Promise<(UnderwritingAssessment & { id: string; organisationId: string }) | undefined>;
  createApproval(
    approval: UnderwritingApproval & { id: string; assessmentId: string },
  ): Promise<UnderwritingApproval>;
  /** Most recent approval recorded for a risk, if any. */
  latestApproval(riskId: string): Promise<UnderwritingApproval | undefined>;
}

export interface StoredListing {
  id: string;
  organisationId: string;
  submissionId: string;
  riskId: string;
  title: string;
  riskClass: string;
  jurisdiction: string;
  capacity: Money;
  status: 'OPEN' | 'MATCHED' | 'WITHDRAWN' | 'EXPIRED';
  durationDays: number;
  listedAt: Date;
  closedAt: Date | null;
}

export interface StoredInterest {
  id: string;
  listingId: string;
  organisationId: string;
  indicativeAmount: Money;
  note: string | null;
  expressedAt: Date;
  withdrawnAt: Date | null;
}

export interface MarketplaceRepository {
  createListing(listing: Omit<StoredListing, 'status' | 'listedAt' | 'closedAt'>): Promise<StoredListing>;
  findListing(id: string): Promise<StoredListing | undefined>;
  findListingBySubmission(submissionId: string): Promise<StoredListing | undefined>;
  listOpenListings(filter: { riskClass?: string; jurisdiction?: string }): Promise<StoredListing[]>;
  setListingStatus(id: string, status: StoredListing['status'], closedAt?: Date): Promise<void>;

  upsertAppetite(profile: CapitalAppetite): Promise<CapitalAppetite>;
  findAppetite(organisationId: string): Promise<CapitalAppetite | undefined>;

  expressInterest(interest: Omit<StoredInterest, 'withdrawnAt'>): Promise<StoredInterest>;
  listInterests(listingId: string): Promise<StoredInterest[]>;
  withdrawInterest(listingId: string, organisationId: string, at: Date): Promise<void>;
}

export interface StoredSyndication {
  id: string;
  listingId: string;
  organisationId: string;
  capacity: Money;
  status: 'OPEN' | 'BOUND' | 'CANCELLED';
  createdAt: Date;
  boundAt: Date | null;
}

export interface AllocationEvent {
  id: string;
  syndicationId: string;
  organisationId: string;
  action: 'PROPOSED' | 'REMOVED' | 'BOUND';
  shareBps: number;
  amount: Money;
  actorSubjectId: string;
  recordedAt: Date;
}

/**
 * Syndication persistence. `bind` is the one method that both writes the
 * final allocation amounts and flips the syndication to BOUND in the same
 * call — implementations must do this atomically (a single transaction in
 * the Prisma adapter), because a syndication that is BOUND with allocations
 * not yet finalised is a state the domain never intends to exist.
 */
export interface SyndicationRepository {
  create(input: {
    id: string;
    listingId: string;
    organisationId: string;
    capacity: Money;
  }): Promise<StoredSyndication>;
  find(id: string): Promise<StoredSyndication | undefined>;
  findByListing(listingId: string): Promise<StoredSyndication | undefined>;

  addAllocation(
    syndicationId: string,
    allocation: Allocation & { id: string },
    actorSubjectId: string,
  ): Promise<void>;
  removeAllocation(
    syndicationId: string,
    organisationId: string,
    actorSubjectId: string,
  ): Promise<void>;
  listAllocations(syndicationId: string): Promise<Allocation[]>;

  /** Atomically: overwrite allocations with final amounts, mark BOUND, append BOUND events. */
  bind(
    syndicationId: string,
    finalAllocations: readonly Allocation[],
    actorSubjectId: string,
    boundAt: Date,
  ): Promise<StoredSyndication>;

  listEvents(syndicationId: string): Promise<AllocationEvent[]>;

  /**
   * Every allocation contribution an organisation holds, across every
   * syndication on the platform — not scoped to one listing. This is the
   * query the capital ledger (Phase 6) is built on: it is what makes a
   * provider's *total* exposure computable at all, rather than only
   * observable one syndication at a time. Deliberately returns only
   * syndication-owned fields; the caller enriches each contribution with
   * listing detail (risk class, jurisdiction, counterparty) via
   * `MarketplaceRepository`, same layering as every other service.
   */
  listAllocationsForOrganisation(
    organisationId: string,
  ): Promise<{ syndicationId: string; status: 'OPEN' | 'BOUND' | 'CANCELLED'; listingId: string; amount: Money }[]>;
}

export interface StoredCapitalCommitment {
  organisationId: string;
  committed: Money;
  updatedAt: Date;
}

export interface CapitalRepository {
  upsertCommitment(organisationId: string, committed: Money): Promise<StoredCapitalCommitment>;
  findCommitment(organisationId: string): Promise<StoredCapitalCommitment | undefined>;
}

export interface StoredClaim {
  id: string;
  syndicationId: string;
  riskId: string;
  organisationId: string;
  status: 'REPORTED' | 'EVIDENCE_COLLECTED' | 'VERIFIED' | 'COVERAGE_CONFIRMED' | 'LOSS_CALCULATED' | 'AWAITING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'SETTLED';
  incidentDescription: string;
  evidenceRefs: string[];
  reportedBy: string;
  claimedLoss: Money | null;
  reviewDecision: 'AUTO' | 'HUMAN_REVIEW' | null;
  approverSubjectId: string | null;
  approvalDecision: 'APPROVED' | 'REJECTED' | null;
  approvalReason: string | null;
  decidedAt: Date | null;
  settledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredClaimPayout {
  claimId: string;
  organisationId: string;
  amount: Money;
}

export interface ClaimsRepository {
  create(input: {
    id: string;
    syndicationId: string;
    riskId: string;
    organisationId: string;
    incidentDescription: string;
    reportedBy: string;
  }): Promise<StoredClaim>;
  find(id: string): Promise<StoredClaim | undefined>;
  listBySyndication(syndicationId: string): Promise<StoredClaim[]>;

  addEvidence(id: string, evidenceRef: string): Promise<StoredClaim>;
  setStatus(id: string, status: StoredClaim['status']): Promise<StoredClaim>;
  setLoss(id: string, claimedLoss: Money, reviewDecision: 'AUTO' | 'HUMAN_REVIEW', status: StoredClaim['status']): Promise<StoredClaim>;
  setApproval(
    id: string,
    approverSubjectId: string,
    decision: 'APPROVED' | 'REJECTED',
    reason: string,
    decidedAt: Date,
    status: StoredClaim['status'],
  ): Promise<StoredClaim>;
  setSettled(id: string, settledAt: Date): Promise<StoredClaim>;

  /** Total claimed loss for every APPROVED or SETTLED claim on a syndication — the running total requireCoverage enforces against. */
  totalApprovedLoss(syndicationId: string, currency: string): Promise<Money>;

  recordPayouts(claimId: string, payouts: readonly StoredClaimPayout[]): Promise<void>;
  listPayouts(claimId: string): Promise<StoredClaimPayout[]>;
}

export const IDENTITY_REPOSITORY = Symbol('IDENTITY_REPOSITORY');
export const AUDIT_REPOSITORY = Symbol('AUDIT_REPOSITORY');
export const GRAPH_REPOSITORY = Symbol('GRAPH_REPOSITORY');
export const SUBMISSION_REPOSITORY = Symbol('SUBMISSION_REPOSITORY');
export const UNDERWRITING_REPOSITORY = Symbol('UNDERWRITING_REPOSITORY');
export const MARKETPLACE_REPOSITORY = Symbol('MARKETPLACE_REPOSITORY');
export const SYNDICATION_REPOSITORY = Symbol('SYNDICATION_REPOSITORY');
export const CAPITAL_REPOSITORY = Symbol('CAPITAL_REPOSITORY');
export const CLAIMS_REPOSITORY = Symbol('CLAIMS_REPOSITORY');
export const CLOCK = Symbol('CLOCK');

export interface Clock {
  now(): Date;
}
