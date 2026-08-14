-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('REPORTED', 'EVIDENCE_COLLECTED', 'VERIFIED', 'COVERAGE_CONFIRMED', 'LOSS_CALCULATED', 'AWAITING_APPROVAL', 'APPROVED', 'REJECTED', 'SETTLED');

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "syndicationId" TEXT NOT NULL,
    "riskId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'REPORTED',
    "incidentDescription" TEXT NOT NULL,
    "evidenceRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reportedBy" TEXT NOT NULL,
    "claimedLossMinor" BIGINT,
    "currency" CHAR(3),
    "reviewDecision" TEXT,
    "approverSubjectId" TEXT,
    "approvalDecision" TEXT,
    "approvalReason" TEXT,
    "decidedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimPayout" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Claim_syndicationId_status_idx" ON "Claim"("syndicationId", "status");

-- CreateIndex
CREATE INDEX "Claim_organisationId_idx" ON "Claim"("organisationId");

-- CreateIndex
CREATE INDEX "ClaimPayout_claimId_idx" ON "ClaimPayout"("claimId");

-- CreateIndex
CREATE INDEX "ClaimPayout_organisationId_idx" ON "ClaimPayout"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimPayout_claimId_organisationId_key" ON "ClaimPayout"("claimId", "organisationId");

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_syndicationId_fkey" FOREIGN KEY ("syndicationId") REFERENCES "Syndication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimPayout" ADD CONSTRAINT "ClaimPayout_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimPayout" ADD CONSTRAINT "ClaimPayout_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
