-- CreateEnum
CREATE TYPE "OrganisationKind" AS ENUM ('COMPANY', 'INDIVIDUAL', 'AI_AGENT', 'REGULATOR');

-- CreateEnum
CREATE TYPE "KybStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MarketRole" AS ENUM ('RISK_ORIGINATOR', 'BROKER', 'UNDERWRITER', 'SYNDICATE', 'CAPITAL_PROVIDER', 'REINSURER', 'INSURER', 'CLAIMS_ADMINISTRATOR', 'SETTLEMENT_PROVIDER', 'REGULATOR');

-- CreateEnum
CREATE TYPE "NodeType" AS ENUM ('ENTITY', 'ASSET', 'DEPENDENCY', 'RISK', 'HAZARD', 'EXPOSURE', 'EVENT', 'LOSS', 'POLICY', 'COVERAGE', 'PREMIUM', 'CLAIM', 'CAPITAL', 'SYNDICATE', 'REINSURANCE_CONTRACT', 'SETTLEMENT');

-- CreateEnum
CREATE TYPE "EdgeType" AS ENUM ('OWNS', 'DEPENDS_ON', 'EXPOSED_TO', 'MAY_CAUSE', 'COVERS', 'SUPPORTS', 'ASSUMES', 'PROTECTS', 'REPRESENTS', 'PAYS', 'SUBJECT_TO');

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('USER_DECLARED', 'DOCUMENT', 'EXTERNAL_FEED', 'SENSOR', 'DERIVED', 'AI_INFERRED');

-- CreateTable
CREATE TABLE "Organisation" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "kind" "OrganisationKind" NOT NULL,
    "jurisdiction" CHAR(2) NOT NULL,
    "kybStatus" "KybStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "principalOrganisationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganisationRole" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "role" "MarketRole" NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" TEXT NOT NULL,

    CONSTRAINT "OrganisationRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "scopes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiCredential" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "secretSalt" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "scopes" TEXT[],
    "subjectKind" TEXT NOT NULL DEFAULT 'SERVICE',
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMandate" (
    "id" TEXT NOT NULL,
    "agentOrganisationId" TEXT NOT NULL,
    "principalOrganisationId" TEXT NOT NULL,
    "permittedActions" TEXT[],
    "maxTransactionValueMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMandate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskNode" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "type" "NodeType" NOT NULL,
    "label" TEXT NOT NULL,
    "jurisdiction" CHAR(2) NOT NULL,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "sourceId" TEXT NOT NULL,
    "sourceKind" "SourceKind" NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "transformations" JSONB NOT NULL DEFAULT '[]',
    "modelId" TEXT,
    "modelVersion" TEXT,
    "referencedData" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskEdge" (
    "id" TEXT NOT NULL,
    "type" "EdgeType" NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "sourceId" TEXT NOT NULL,
    "sourceKind" "SourceKind" NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "transformations" JSONB NOT NULL DEFAULT '[]',
    "modelId" TEXT,
    "modelVersion" TEXT,
    "referencedData" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditRecord" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorOrganisationId" TEXT NOT NULL,
    "actorSubjectId" TEXT NOT NULL,
    "actorSubjectKind" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "policy" TEXT,
    "modelId" TEXT,
    "modelVersion" TEXT,
    "ontologyVersion" TEXT NOT NULL,

    CONSTRAINT "AuditRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Organisation_jurisdiction_idx" ON "Organisation"("jurisdiction");

-- CreateIndex
CREATE INDEX "Organisation_principalOrganisationId_idx" ON "Organisation"("principalOrganisationId");

-- CreateIndex
CREATE INDEX "OrganisationRole_role_idx" ON "OrganisationRole"("role");

-- CreateIndex
CREATE UNIQUE INDEX "OrganisationRole_organisationId_role_key" ON "OrganisationRole"("organisationId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_organisationId_idx" ON "User"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiCredential_keyId_key" ON "ApiCredential"("keyId");

-- CreateIndex
CREATE INDEX "ApiCredential_organisationId_idx" ON "ApiCredential"("organisationId");

-- CreateIndex
CREATE INDEX "AgentMandate_agentOrganisationId_idx" ON "AgentMandate"("agentOrganisationId");

-- CreateIndex
CREATE INDEX "RiskNode_organisationId_type_idx" ON "RiskNode"("organisationId", "type");

-- CreateIndex
CREATE INDEX "RiskNode_type_idx" ON "RiskNode"("type");

-- CreateIndex
CREATE INDEX "RiskNode_sourceKind_idx" ON "RiskNode"("sourceKind");

-- CreateIndex
CREATE INDEX "RiskEdge_fromId_type_idx" ON "RiskEdge"("fromId", "type");

-- CreateIndex
CREATE INDEX "RiskEdge_toId_type_idx" ON "RiskEdge"("toId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "RiskEdge_type_fromId_toId_key" ON "RiskEdge"("type", "fromId", "toId");

-- CreateIndex
CREATE INDEX "AuditRecord_actorOrganisationId_at_idx" ON "AuditRecord"("actorOrganisationId", "at");

-- CreateIndex
CREATE INDEX "AuditRecord_subjectType_subjectId_idx" ON "AuditRecord"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "AuditRecord_action_at_idx" ON "AuditRecord"("action", "at");

-- AddForeignKey
ALTER TABLE "Organisation" ADD CONSTRAINT "Organisation_principalOrganisationId_fkey" FOREIGN KEY ("principalOrganisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationRole" ADD CONSTRAINT "OrganisationRole_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiCredential" ADD CONSTRAINT "ApiCredential_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMandate" ADD CONSTRAINT "AgentMandate_agentOrganisationId_fkey" FOREIGN KEY ("agentOrganisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMandate" ADD CONSTRAINT "AgentMandate_principalOrganisationId_fkey" FOREIGN KEY ("principalOrganisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskNode" ADD CONSTRAINT "RiskNode_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEdge" ADD CONSTRAINT "RiskEdge_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "RiskNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEdge" ADD CONSTRAINT "RiskEdge_toId_fkey" FOREIGN KEY ("toId") REFERENCES "RiskNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRecord" ADD CONSTRAINT "AuditRecord_actorOrganisationId_fkey" FOREIGN KEY ("actorOrganisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
