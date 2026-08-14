import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  money,
  provenance,
  DomainError,
  type AgentMandate,
  type Allocation,
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

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

/** Maps a persisted row's inlined provenance columns back to the domain type. */
function toProvenance(row: {
  sourceId: string;
  sourceKind: string;
  observedAt: Date;
  recordedAt: Date;
  confidence: number;
  transformations: unknown;
  modelId: string | null;
  modelVersion: string | null;
  referencedData: string[];
}) {
  return provenance({
    sourceId: row.sourceId,
    sourceKind: row.sourceKind as never,
    observedAt: row.observedAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
    confidence: row.confidence,
    transformations: (row.transformations as never) ?? [],
    ...(row.modelId ? { modelId: row.modelId } : {}),
    ...(row.modelVersion ? { modelVersion: row.modelVersion } : {}),
    ...(row.referencedData.length > 0 ? { referencedData: row.referencedData } : {}),
  });
}

function provenanceColumns(p: RiskNode['provenance']) {
  return {
    sourceId: p.sourceId,
    sourceKind: p.sourceKind as never,
    observedAt: new Date(p.observedAt),
    recordedAt: new Date(p.recordedAt),
    confidence: p.confidence,
    transformations: p.transformations as never,
    modelId: p.modelId ?? null,
    modelVersion: p.modelVersion ?? null,
    referencedData: [...(p.referencedData ?? [])],
  };
}

@Injectable()
export class PrismaIdentityRepository implements IdentityRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private toDomain(row: {
    id: string;
    legalName: string;
    kind: string;
    jurisdiction: string;
    kybStatus: string;
    active: boolean;
    principalOrganisationId: string | null;
    roles: { role: string }[];
  }): Organisation {
    return {
      id: row.id,
      legalName: row.legalName,
      kind: row.kind as Organisation['kind'],
      jurisdiction: row.jurisdiction,
      kybStatus: row.kybStatus as Organisation['kybStatus'],
      active: row.active,
      roles: row.roles.map((r) => r.role as MarketRole),
      ...(row.principalOrganisationId
        ? { principalOrganisationId: row.principalOrganisationId }
        : {}),
    };
  }

  async createOrganisation(input: {
    id: string;
    legalName: string;
    kind: Organisation['kind'];
    jurisdiction: string;
    principalOrganisationId?: string;
  }): Promise<Organisation> {
    const row = await this.prisma.organisation.create({
      data: {
        id: input.id,
        legalName: input.legalName,
        kind: input.kind as never,
        jurisdiction: input.jurisdiction,
        principalOrganisationId: input.principalOrganisationId ?? null,
      },
      include: { roles: true },
    });
    return this.toDomain(row);
  }

  async findOrganisation(id: string): Promise<Organisation | undefined> {
    const row = await this.prisma.organisation.findUnique({
      where: { id },
      include: { roles: true },
    });
    return row ? this.toDomain(row) : undefined;
  }

  async listOrganisations(): Promise<Organisation[]> {
    const rows = await this.prisma.organisation.findMany({ include: { roles: true } });
    return rows.map((row) => this.toDomain(row));
  }

  async grantRole(
    organisationId: string,
    role: MarketRole,
    grantedBy: string,
  ): Promise<Organisation> {
    await this.prisma.organisationRole.upsert({
      where: { organisationId_role: { organisationId, role: role as never } },
      create: { organisationId, role: role as never, grantedBy },
      update: {},
    });
    const org = await this.findOrganisation(organisationId);
    if (!org) throw new Error(`Unknown organisation: ${organisationId}`);
    return org;
  }

  async setKybStatus(
    organisationId: string,
    kybStatus: Organisation['kybStatus'],
  ): Promise<Organisation> {
    const row = await this.prisma.organisation.update({
      where: { id: organisationId },
      data: { kybStatus: kybStatus as never },
      include: { roles: true },
    });
    return this.toDomain(row);
  }

  async createCredential(
    input: Omit<StoredCredential, 'revokedAt'>,
  ): Promise<StoredCredential> {
    const row = await this.prisma.apiCredential.create({
      data: {
        id: input.id,
        keyId: input.keyId,
        secretHash: input.secretHash,
        secretSalt: input.secretSalt,
        organisationId: input.organisationId,
        label: input.label,
        scopes: input.scopes,
        subjectKind: input.subjectKind,
        expiresAt: input.expiresAt,
      },
    });
    return { ...input, revokedAt: row.revokedAt };
  }

  async findCredentialByKeyId(keyId: string): Promise<StoredCredential | undefined> {
    const row = await this.prisma.apiCredential.findUnique({ where: { keyId } });
    if (!row) return undefined;
    return {
      id: row.id,
      keyId: row.keyId,
      secretHash: row.secretHash,
      secretSalt: row.secretSalt,
      organisationId: row.organisationId,
      label: row.label,
      scopes: row.scopes,
      subjectKind: row.subjectKind as StoredCredential['subjectKind'],
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
    };
  }

  async revokeCredential(keyId: string): Promise<void> {
    await this.prisma.apiCredential.update({
      where: { keyId },
      data: { revokedAt: new Date() },
    });
  }

  async createMandate(mandate: AgentMandate & { id: string }): Promise<AgentMandate> {
    await this.prisma.agentMandate.create({
      data: {
        id: mandate.id,
        agentOrganisationId: mandate.agentOrganisationId,
        principalOrganisationId: mandate.principalOrganisationId,
        permittedActions: [...mandate.permittedActions],
        maxTransactionValueMinor: BigInt(mandate.maxTransactionValueMinor),
        currency: mandate.currency,
        expiresAt: new Date(mandate.expiresAt),
      },
    });
    return mandate;
  }

  async findActiveMandate(agentOrganisationId: string): Promise<AgentMandate | undefined> {
    const row = await this.prisma.agentMandate.findFirst({
      where: { agentOrganisationId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return undefined;
    return {
      agentOrganisationId: row.agentOrganisationId,
      principalOrganisationId: row.principalOrganisationId,
      permittedActions: row.permittedActions,
      maxTransactionValueMinor: Number(row.maxTransactionValueMinor),
      currency: row.currency,
      expiresAt: row.expiresAt.toISOString(),
    };
  }
}

@Injectable()
export class PrismaAuditRepository implements AuditRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async append(record: AuditRecord): Promise<void> {
    await this.prisma.auditRecord.create({
      data: {
        id: record.id,
        at: new Date(record.at),
        actorOrganisationId: record.actorOrganisationId,
        actorSubjectId: record.actorSubjectId,
        actorSubjectKind: record.actorSubjectKind,
        action: record.action,
        subjectType: record.subjectType,
        subjectId: record.subjectId,
        decision: record.decision,
        reason: record.reason,
        before: (record.before ?? null) as never,
        after: (record.after ?? null) as never,
        policy: record.policy ?? null,
        modelId: record.modelId ?? null,
        modelVersion: record.modelVersion ?? null,
        ontologyVersion: record.ontologyVersion,
      },
    });
  }

  async list(filter: {
    organisationId?: string;
    subjectId?: string;
    limit: number;
  }): Promise<AuditRecord[]> {
    const rows = await this.prisma.auditRecord.findMany({
      where: {
        ...(filter.organisationId ? { actorOrganisationId: filter.organisationId } : {}),
        ...(filter.subjectId ? { subjectId: filter.subjectId } : {}),
      },
      orderBy: { at: 'desc' },
      take: filter.limit,
    });
    return rows.map((row) => ({
      ...row,
      at: row.at.toISOString(),
      decision: row.decision as AuditRecord['decision'],
      policy: row.policy ?? undefined,
      modelId: row.modelId ?? undefined,
      modelVersion: row.modelVersion ?? undefined,
    }));
  }
}

@Injectable()
export class PrismaGraphRepository implements GraphRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createNode(node: RiskNode): Promise<RiskNode> {
    await this.prisma.riskNode.create({
      data: {
        id: node.id,
        organisationId: node.organisationId,
        type: node.type as never,
        label: node.label,
        jurisdiction: node.jurisdiction,
        attributes: node.attributes as never,
        ...provenanceColumns(node.provenance),
      },
    });
    return node;
  }

  async createEdge(edge: RiskEdge): Promise<RiskEdge> {
    await this.prisma.riskEdge.create({
      data: {
        id: edge.id,
        type: edge.type as never,
        fromId: edge.fromId,
        toId: edge.toId,
        attributes: edge.attributes as never,
        ...provenanceColumns(edge.provenance),
      },
    });
    return edge;
  }

  async findNode(id: string): Promise<RiskNode | undefined> {
    const row = await this.prisma.riskNode.findUnique({ where: { id } });
    if (!row) return undefined;
    return {
      id: row.id,
      organisationId: row.organisationId,
      type: row.type as RiskNode['type'],
      label: row.label,
      jurisdiction: row.jurisdiction,
      attributes: (row.attributes ?? {}) as Record<string, unknown>,
      provenance: toProvenance(row),
    };
  }

  async loadSubgraph(
    organisationId: string,
  ): Promise<{ nodes: RiskNode[]; edges: RiskEdge[] }> {
    const nodeRows = await this.prisma.riskNode.findMany({ where: { organisationId } });
    const ids = nodeRows.map((n) => n.id);
    const edgeRows = await this.prisma.riskEdge.findMany({
      where: { fromId: { in: ids }, toId: { in: ids } },
    });

    return {
      nodes: nodeRows.map((row) => ({
        id: row.id,
        organisationId: row.organisationId,
        type: row.type as RiskNode['type'],
        label: row.label,
        jurisdiction: row.jurisdiction,
        attributes: (row.attributes ?? {}) as Record<string, unknown>,
        provenance: toProvenance(row),
      })),
      edges: edgeRows.map((row) => ({
        id: row.id,
        type: row.type as RiskEdge['type'],
        fromId: row.fromId,
        toId: row.toId,
        attributes: (row.attributes ?? {}) as Record<string, unknown>,
        provenance: toProvenance(row),
      })),
    };
  }
}

@Injectable()
export class PrismaSubmissionRepository implements SubmissionRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private toDomain(row: {
    id: string;
    organisationId: string;
    riskId: string;
    title: string;
    status: string;
    submittedBy: string;
    createdAt: Date;
    updatedAt: Date;
  }): RiskSubmission {
    return {
      id: row.id,
      organisationId: row.organisationId,
      riskId: row.riskId,
      title: row.title,
      status: row.status as SubmissionStatus,
      submittedBy: row.submittedBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async create(submission: RiskSubmission): Promise<RiskSubmission> {
    const row = await this.prisma.riskSubmission.create({
      data: {
        id: submission.id,
        organisationId: submission.organisationId,
        riskId: submission.riskId,
        title: submission.title,
        status: submission.status as never,
        submittedBy: submission.submittedBy,
      },
    });
    return this.toDomain(row);
  }

  async advance(
    id: string,
    to: SubmissionStatus,
    _updatedAt: Date,
  ): Promise<RiskSubmission | undefined> {
    try {
      const row = await this.prisma.riskSubmission.update({
        where: { id },
        data: { status: to as never },
      });
      return this.toDomain(row);
    } catch {
      return undefined;
    }
  }

  async find(id: string): Promise<RiskSubmission | undefined> {
    const row = await this.prisma.riskSubmission.findUnique({ where: { id } });
    return row ? this.toDomain(row) : undefined;
  }

  async listByOrganisation(organisationId: string): Promise<RiskSubmission[]> {
    const rows = await this.prisma.riskSubmission.findMany({ where: { organisationId } });
    return rows.map((row) => this.toDomain(row));
  }
}

@Injectable()
export class PrismaUnderwritingRepository implements UnderwritingRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private assessmentToDomain(row: {
    id: string;
    riskId: string;
    organisationId: string;
    eligible: boolean;
    band: string;
    control: string;
    requiresHumanApproval: boolean;
    riskScoreConfidence: number;
    expectedLossMinor: bigint;
    currency: string;
    premiumLowMinor: bigint;
    premiumHighMinor: bigint;
    capitalRequirementMinor: bigint;
    suggestedCapacityMinor: bigint;
    exclusions: string[];
    conditions: string[];
    requiredEvidence: string[];
    modelVersion: string;
    assessedAt: Date;
  }): UnderwritingAssessment & { id: string; organisationId: string } {
    return {
      id: row.id,
      organisationId: row.organisationId,
      riskId: row.riskId,
      eligible: row.eligible,
      band: row.band as UnderwritingAssessment['band'],
      control: row.control as UnderwritingAssessment['control'],
      requiresHumanApproval: row.requiresHumanApproval,
      riskScoreConfidence: row.riskScoreConfidence,
      expectedLoss: money(Number(row.expectedLossMinor), row.currency),
      suggestedPremiumRange: {
        low: money(Number(row.premiumLowMinor), row.currency),
        high: money(Number(row.premiumHighMinor), row.currency),
      },
      capitalRequirement: money(Number(row.capitalRequirementMinor), row.currency),
      suggestedCapacity: money(Number(row.suggestedCapacityMinor), row.currency),
      exclusions: row.exclusions,
      conditions: row.conditions,
      requiredEvidence: row.requiredEvidence,
      modelVersion: row.modelVersion,
      assessedAt: row.assessedAt.toISOString(),
    };
  }

  async createAssessment(
    assessment: UnderwritingAssessment & { id: string; organisationId: string },
  ) {
    const row = await this.prisma.underwritingAssessment.create({
      data: {
        id: assessment.id,
        riskId: assessment.riskId,
        organisationId: assessment.organisationId,
        eligible: assessment.eligible,
        band: assessment.band,
        control: assessment.control,
        requiresHumanApproval: assessment.requiresHumanApproval,
        riskScoreConfidence: assessment.riskScoreConfidence,
        expectedLossMinor: BigInt(assessment.expectedLoss.amountMinor),
        currency: assessment.expectedLoss.currency,
        premiumLowMinor: BigInt(assessment.suggestedPremiumRange.low.amountMinor),
        premiumHighMinor: BigInt(assessment.suggestedPremiumRange.high.amountMinor),
        capitalRequirementMinor: BigInt(assessment.capitalRequirement.amountMinor),
        suggestedCapacityMinor: BigInt(assessment.suggestedCapacity.amountMinor),
        exclusions: [...assessment.exclusions],
        conditions: [...assessment.conditions],
        requiredEvidence: [...assessment.requiredEvidence],
        modelVersion: assessment.modelVersion,
      },
    });
    return this.assessmentToDomain(row);
  }

  async latestAssessment(riskId: string) {
    const row = await this.prisma.underwritingAssessment.findFirst({
      where: { riskId },
      orderBy: { assessedAt: 'desc' },
    });
    return row ? this.assessmentToDomain(row) : undefined;
  }

  async createApproval(approval: UnderwritingApproval & { id: string; assessmentId: string }) {
    const row = await this.prisma.underwritingApproval.create({
      data: {
        id: approval.id,
        riskId: approval.riskId,
        assessmentId: approval.assessmentId,
        assessmentModelVersion: approval.assessmentModelVersion,
        approverSubjectId: approval.approverSubjectId,
        decision: approval.decision,
        reason: approval.reason,
      },
    });
    return {
      riskId: row.riskId,
      assessmentModelVersion: row.assessmentModelVersion,
      approverSubjectId: row.approverSubjectId,
      decision: row.decision as UnderwritingApproval['decision'],
      reason: row.reason,
      decidedAt: row.decidedAt.toISOString(),
    };
  }

  async latestApproval(riskId: string): Promise<UnderwritingApproval | undefined> {
    const row = await this.prisma.underwritingApproval.findFirst({
      where: { riskId },
      orderBy: { decidedAt: 'desc' },
    });
    if (!row) return undefined;
    return {
      riskId: row.riskId,
      assessmentModelVersion: row.assessmentModelVersion,
      approverSubjectId: row.approverSubjectId,
      decision: row.decision as UnderwritingApproval['decision'],
      reason: row.reason,
      decidedAt: row.decidedAt.toISOString(),
    };
  }
}

@Injectable()
export class PrismaMarketplaceRepository implements MarketplaceRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private listingToDomain(row: {
    id: string;
    organisationId: string;
    submissionId: string;
    riskId: string;
    title: string;
    riskClass: string;
    jurisdiction: string;
    capacityMinor: bigint;
    currency: string;
    durationDays: number;
    status: string;
    listedAt: Date;
    closedAt: Date | null;
  }): StoredListing {
    return {
      id: row.id,
      organisationId: row.organisationId,
      submissionId: row.submissionId,
      riskId: row.riskId,
      title: row.title,
      riskClass: row.riskClass,
      jurisdiction: row.jurisdiction,
      capacity: money(Number(row.capacityMinor), row.currency),
      status: row.status as StoredListing['status'],
      durationDays: row.durationDays,
      listedAt: row.listedAt,
      closedAt: row.closedAt,
    };
  }

  async createListing(
    listing: Omit<StoredListing, 'status' | 'listedAt' | 'closedAt'>,
  ): Promise<StoredListing> {
    const row = await this.prisma.marketListing.create({
      data: {
        id: listing.id,
        organisationId: listing.organisationId,
        submissionId: listing.submissionId,
        riskId: listing.riskId,
        title: listing.title,
        riskClass: listing.riskClass,
        jurisdiction: listing.jurisdiction,
        capacityMinor: BigInt(listing.capacity.amountMinor),
        currency: listing.capacity.currency,
        durationDays: listing.durationDays,
      },
    });
    return this.listingToDomain(row);
  }

  async findListing(id: string): Promise<StoredListing | undefined> {
    const row = await this.prisma.marketListing.findUnique({ where: { id } });
    return row ? this.listingToDomain(row) : undefined;
  }

  async findListingBySubmission(submissionId: string): Promise<StoredListing | undefined> {
    const row = await this.prisma.marketListing.findUnique({ where: { submissionId } });
    return row ? this.listingToDomain(row) : undefined;
  }

  async listOpenListings(filter: { riskClass?: string; jurisdiction?: string }): Promise<StoredListing[]> {
    const rows = await this.prisma.marketListing.findMany({
      where: {
        status: 'OPEN',
        ...(filter.riskClass ? { riskClass: filter.riskClass } : {}),
        ...(filter.jurisdiction ? { jurisdiction: filter.jurisdiction } : {}),
      },
    });
    return rows.map((row) => this.listingToDomain(row));
  }

  async setListingStatus(id: string, status: StoredListing['status'], closedAt?: Date): Promise<void> {
    await this.prisma.marketListing.update({
      where: { id },
      data: { status, ...(closedAt ? { closedAt } : {}) },
    });
  }

  async upsertAppetite(profile: CapitalAppetite): Promise<CapitalAppetite> {
    await this.prisma.capitalAppetiteProfile.upsert({
      where: { organisationId: profile.organisationId },
      create: {
        organisationId: profile.organisationId,
        preferredRiskClasses: [...profile.preferredRiskClasses],
        maxExposureMinor: BigInt(profile.maxExposure.amountMinor),
        currency: profile.maxExposure.currency,
        preferredJurisdictions: [...profile.preferredJurisdictions],
        minimumReturnBps: profile.minimumReturnBps,
        maxDurationDays: profile.maxDurationDays,
        riskTolerance: profile.riskTolerance,
        concentrationLimitBps: profile.concentrationLimitBps,
      },
      update: {
        preferredRiskClasses: [...profile.preferredRiskClasses],
        maxExposureMinor: BigInt(profile.maxExposure.amountMinor),
        currency: profile.maxExposure.currency,
        preferredJurisdictions: [...profile.preferredJurisdictions],
        minimumReturnBps: profile.minimumReturnBps,
        maxDurationDays: profile.maxDurationDays,
        riskTolerance: profile.riskTolerance,
        concentrationLimitBps: profile.concentrationLimitBps,
      },
    });
    return profile;
  }

  async findAppetite(organisationId: string): Promise<CapitalAppetite | undefined> {
    const row = await this.prisma.capitalAppetiteProfile.findUnique({ where: { organisationId } });
    if (!row) return undefined;
    return {
      organisationId: row.organisationId,
      preferredRiskClasses: row.preferredRiskClasses,
      maxExposure: money(Number(row.maxExposureMinor), row.currency),
      preferredJurisdictions: row.preferredJurisdictions,
      minimumReturnBps: row.minimumReturnBps,
      maxDurationDays: row.maxDurationDays,
      riskTolerance: row.riskTolerance as CapitalAppetite['riskTolerance'],
      concentrationLimitBps: row.concentrationLimitBps,
    };
  }

  async expressInterest(interest: Omit<StoredInterest, 'withdrawnAt'>): Promise<StoredInterest> {
    const row = await this.prisma.capitalInterest.upsert({
      where: {
        listingId_organisationId: {
          listingId: interest.listingId,
          organisationId: interest.organisationId,
        },
      },
      create: {
        id: interest.id,
        listingId: interest.listingId,
        organisationId: interest.organisationId,
        indicativeAmountMinor: BigInt(interest.indicativeAmount.amountMinor),
        currency: interest.indicativeAmount.currency,
        note: interest.note,
      },
      update: {
        indicativeAmountMinor: BigInt(interest.indicativeAmount.amountMinor),
        currency: interest.indicativeAmount.currency,
        note: interest.note,
        withdrawnAt: null,
      },
    });
    return {
      id: row.id,
      listingId: row.listingId,
      organisationId: row.organisationId,
      indicativeAmount: money(Number(row.indicativeAmountMinor), row.currency),
      note: row.note,
      expressedAt: row.expressedAt,
      withdrawnAt: row.withdrawnAt,
    };
  }

  async listInterests(listingId: string): Promise<StoredInterest[]> {
    const rows = await this.prisma.capitalInterest.findMany({ where: { listingId } });
    return rows.map((row) => ({
      id: row.id,
      listingId: row.listingId,
      organisationId: row.organisationId,
      indicativeAmount: money(Number(row.indicativeAmountMinor), row.currency),
      note: row.note,
      expressedAt: row.expressedAt,
      withdrawnAt: row.withdrawnAt,
    }));
  }

  async withdrawInterest(listingId: string, organisationId: string, at: Date): Promise<void> {
    await this.prisma.capitalInterest.update({
      where: { listingId_organisationId: { listingId, organisationId } },
      data: { withdrawnAt: at },
    });
  }
}

@Injectable()
export class PrismaSyndicationRepository implements SyndicationRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private toDomain(row: {
    id: string;
    listingId: string;
    organisationId: string;
    capacityMinor: bigint;
    currency: string;
    status: string;
    createdAt: Date;
    boundAt: Date | null;
  }): StoredSyndication {
    return {
      id: row.id,
      listingId: row.listingId,
      organisationId: row.organisationId,
      capacity: money(Number(row.capacityMinor), row.currency),
      status: row.status as StoredSyndication['status'],
      createdAt: row.createdAt,
      boundAt: row.boundAt,
    };
  }

  async create(input: {
    id: string;
    listingId: string;
    organisationId: string;
    capacity: Money;
  }): Promise<StoredSyndication> {
    const row = await this.prisma.syndication.create({
      data: {
        id: input.id,
        listingId: input.listingId,
        organisationId: input.organisationId,
        capacityMinor: BigInt(input.capacity.amountMinor),
        currency: input.capacity.currency,
      },
    });
    return this.toDomain(row);
  }

  async find(id: string): Promise<StoredSyndication | undefined> {
    const row = await this.prisma.syndication.findUnique({ where: { id } });
    return row ? this.toDomain(row) : undefined;
  }

  async findByListing(listingId: string): Promise<StoredSyndication | undefined> {
    const row = await this.prisma.syndication.findUnique({ where: { listingId } });
    return row ? this.toDomain(row) : undefined;
  }

  /**
   * Guards against mutating a non-OPEN syndication at the application layer,
   * in addition to (not instead of) the database triggers that freeze
   * `SyndicationAllocation` rows once BOUND — belt and braces on the one
   * invariant in this codebase where "the code was buggy" must never be an
   * excuse for an altered commitment.
   */
  private async requireOpen(syndicationId: string): Promise<void> {
    const syndication = await this.prisma.syndication.findUniqueOrThrow({
      where: { id: syndicationId },
    });
    if (syndication.status !== 'OPEN') {
      throw new DomainError('Cannot mutate allocations on a non-OPEN syndication', 'SYNDICATION_NOT_OPEN', {
        syndicationId,
        status: syndication.status,
      });
    }
  }

  async addAllocation(
    syndicationId: string,
    allocation: Allocation & { id: string },
    actorSubjectId: string,
  ): Promise<void> {
    await this.requireOpen(syndicationId);
    await this.prisma.$transaction([
      this.prisma.syndicationAllocation.create({
        data: {
          id: allocation.id,
          syndicationId,
          organisationId: allocation.organisationId,
          shareBps: allocation.shareBps,
          amountMinor: BigInt(allocation.amount.amountMinor),
          currency: allocation.amount.currency,
        },
      }),
      this.prisma.syndicationAllocationEvent.create({
        data: {
          id: `${allocation.id}-proposed`,
          syndicationId,
          organisationId: allocation.organisationId,
          action: 'PROPOSED',
          shareBps: allocation.shareBps,
          amountMinor: BigInt(allocation.amount.amountMinor),
          currency: allocation.amount.currency,
          actorSubjectId,
        },
      }),
    ]);
  }

  async removeAllocation(
    syndicationId: string,
    organisationId: string,
    actorSubjectId: string,
  ): Promise<void> {
    await this.requireOpen(syndicationId);
    const existing = await this.prisma.syndicationAllocation.findUnique({
      where: { syndicationId_organisationId: { syndicationId, organisationId } },
    });
    if (!existing) return;

    await this.prisma.$transaction([
      this.prisma.syndicationAllocationEvent.create({
        data: {
          id: `${existing.id}-removed-${Date.now()}`,
          syndicationId,
          organisationId,
          action: 'REMOVED',
          shareBps: existing.shareBps,
          amountMinor: existing.amountMinor,
          currency: existing.currency,
          actorSubjectId,
        },
      }),
      this.prisma.syndicationAllocation.delete({ where: { id: existing.id } }),
    ]);
  }

  async listAllocations(syndicationId: string): Promise<Allocation[]> {
    const rows = await this.prisma.syndicationAllocation.findMany({ where: { syndicationId } });
    return rows.map((row) => ({
      organisationId: row.organisationId,
      shareBps: row.shareBps,
      amount: money(Number(row.amountMinor), row.currency),
    }));
  }

  async bind(
    syndicationId: string,
    finalAllocations: readonly Allocation[],
    actorSubjectId: string,
    boundAt: Date,
  ): Promise<StoredSyndication> {
    const existing = await this.prisma.syndicationAllocation.findMany({ where: { syndicationId } });
    const idByOrg = new Map(existing.map((row) => [row.organisationId, row.id]));

    // Order matters: allocation amounts are finalised while the syndication
    // is still OPEN (so the freeze trigger does not block these updates),
    // and only then does the status flip to BOUND within the same
    // transaction — the two are atomic from any external observer's view.
    await this.prisma.$transaction([
      ...finalAllocations.map((allocation) =>
        this.prisma.syndicationAllocation.update({
          where: { id: idByOrg.get(allocation.organisationId) },
          data: { amountMinor: BigInt(allocation.amount.amountMinor) },
        }),
      ),
      this.prisma.syndication.update({
        where: { id: syndicationId },
        data: { status: 'BOUND', boundAt },
      }),
      ...finalAllocations.map((allocation) =>
        this.prisma.syndicationAllocationEvent.create({
          data: {
            id: `${syndicationId}-${allocation.organisationId}-bound`,
            syndicationId,
            organisationId: allocation.organisationId,
            action: 'BOUND',
            shareBps: allocation.shareBps,
            amountMinor: BigInt(allocation.amount.amountMinor),
            currency: allocation.amount.currency,
            actorSubjectId,
          },
        }),
      ),
    ]);

    const row = await this.prisma.syndication.findUniqueOrThrow({ where: { id: syndicationId } });
    return this.toDomain(row);
  }

  async listEvents(syndicationId: string): Promise<AllocationEvent[]> {
    const rows = await this.prisma.syndicationAllocationEvent.findMany({
      where: { syndicationId },
      orderBy: { recordedAt: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      syndicationId: row.syndicationId,
      organisationId: row.organisationId,
      action: row.action as AllocationEvent['action'],
      shareBps: row.shareBps,
      amount: money(Number(row.amountMinor), row.currency),
      actorSubjectId: row.actorSubjectId,
      recordedAt: row.recordedAt,
    }));
  }

  async listAllocationsForOrganisation(
    organisationId: string,
  ): Promise<{ syndicationId: string; status: 'OPEN' | 'BOUND' | 'CANCELLED'; listingId: string; amount: Money }[]> {
    const rows = await this.prisma.syndicationAllocation.findMany({
      where: { organisationId },
      include: { syndication: { select: { status: true, listingId: true } } },
    });
    return rows.map((row) => ({
      syndicationId: row.syndicationId,
      status: row.syndication.status as 'OPEN' | 'BOUND' | 'CANCELLED',
      listingId: row.syndication.listingId,
      amount: money(Number(row.amountMinor), row.currency),
    }));
  }
}

@Injectable()
export class PrismaCapitalRepository implements CapitalRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async upsertCommitment(organisationId: string, committed: Money): Promise<StoredCapitalCommitment> {
    const row = await this.prisma.capitalCommitment.upsert({
      where: { organisationId },
      create: {
        id: randomUUID(),
        organisationId,
        committedMinor: BigInt(committed.amountMinor),
        currency: committed.currency,
      },
      update: {
        committedMinor: BigInt(committed.amountMinor),
        currency: committed.currency,
      },
    });
    return { organisationId, committed: money(Number(row.committedMinor), row.currency), updatedAt: row.updatedAt };
  }

  async findCommitment(organisationId: string): Promise<StoredCapitalCommitment | undefined> {
    const row = await this.prisma.capitalCommitment.findUnique({ where: { organisationId } });
    if (!row) return undefined;
    return { organisationId, committed: money(Number(row.committedMinor), row.currency), updatedAt: row.updatedAt };
  }
}
