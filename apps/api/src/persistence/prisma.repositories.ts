import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  provenance,
  type AgentMandate,
  type AuditRecord,
  type MarketRole,
  type Organisation,
  type RiskEdge,
  type RiskNode,
} from '@neo-lloyds/domain';
import type {
  AuditRepository,
  GraphRepository,
  IdentityRepository,
  StoredCredential,
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
