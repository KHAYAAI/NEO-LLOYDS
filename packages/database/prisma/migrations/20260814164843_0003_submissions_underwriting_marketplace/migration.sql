-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'ANALYSING', 'SCORED', 'READY_FOR_UNDERWRITING');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('OPEN', 'MATCHED', 'WITHDRAWN', 'EXPIRED');

-- CreateTable
CREATE TABLE "RiskSubmission" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "riskId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnderwritingAssessment" (
    "id" TEXT NOT NULL,
    "riskId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "eligible" BOOLEAN NOT NULL,
    "band" TEXT NOT NULL,
    "control" TEXT NOT NULL,
    "requiresHumanApproval" BOOLEAN NOT NULL,
    "riskScoreConfidence" DOUBLE PRECISION NOT NULL,
    "expectedLossMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "premiumLowMinor" BIGINT NOT NULL,
    "premiumHighMinor" BIGINT NOT NULL,
    "capitalRequirementMinor" BIGINT NOT NULL,
    "suggestedCapacityMinor" BIGINT NOT NULL,
    "exclusions" TEXT[],
    "conditions" TEXT[],
    "requiredEvidence" TEXT[],
    "modelVersion" TEXT NOT NULL,
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnderwritingAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnderwritingApproval" (
    "id" TEXT NOT NULL,
    "riskId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "assessmentModelVersion" TEXT NOT NULL,
    "approverSubjectId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnderwritingApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketListing" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "riskId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "riskClass" TEXT NOT NULL,
    "jurisdiction" CHAR(2) NOT NULL,
    "capacityMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'OPEN',
    "listedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "MarketListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapitalAppetiteProfile" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "preferredRiskClasses" TEXT[],
    "maxExposureMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "preferredJurisdictions" TEXT[],
    "minimumReturnBps" INTEGER NOT NULL,
    "maxDurationDays" INTEGER NOT NULL,
    "riskTolerance" TEXT NOT NULL,
    "concentrationLimitBps" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CapitalAppetiteProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapitalInterest" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "indicativeAmountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "note" TEXT,
    "expressedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),

    CONSTRAINT "CapitalInterest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RiskSubmission_organisationId_status_idx" ON "RiskSubmission"("organisationId", "status");

-- CreateIndex
CREATE INDEX "RiskSubmission_riskId_idx" ON "RiskSubmission"("riskId");

-- CreateIndex
CREATE INDEX "UnderwritingAssessment_riskId_assessedAt_idx" ON "UnderwritingAssessment"("riskId", "assessedAt");

-- CreateIndex
CREATE INDEX "UnderwritingAssessment_organisationId_idx" ON "UnderwritingAssessment"("organisationId");

-- CreateIndex
CREATE INDEX "UnderwritingApproval_riskId_decidedAt_idx" ON "UnderwritingApproval"("riskId", "decidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketListing_submissionId_key" ON "MarketListing"("submissionId");

-- CreateIndex
CREATE INDEX "MarketListing_organisationId_status_idx" ON "MarketListing"("organisationId", "status");

-- CreateIndex
CREATE INDEX "MarketListing_riskClass_jurisdiction_status_idx" ON "MarketListing"("riskClass", "jurisdiction", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CapitalAppetiteProfile_organisationId_key" ON "CapitalAppetiteProfile"("organisationId");

-- CreateIndex
CREATE INDEX "CapitalAppetiteProfile_organisationId_idx" ON "CapitalAppetiteProfile"("organisationId");

-- CreateIndex
CREATE INDEX "CapitalInterest_listingId_idx" ON "CapitalInterest"("listingId");

-- CreateIndex
CREATE INDEX "CapitalInterest_organisationId_idx" ON "CapitalInterest"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "CapitalInterest_listingId_organisationId_key" ON "CapitalInterest"("listingId", "organisationId");

-- AddForeignKey
ALTER TABLE "RiskSubmission" ADD CONSTRAINT "RiskSubmission_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnderwritingAssessment" ADD CONSTRAINT "UnderwritingAssessment_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnderwritingApproval" ADD CONSTRAINT "UnderwritingApproval_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "UnderwritingAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketListing" ADD CONSTRAINT "MarketListing_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketListing" ADD CONSTRAINT "MarketListing_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "RiskSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapitalAppetiteProfile" ADD CONSTRAINT "CapitalAppetiteProfile_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapitalInterest" ADD CONSTRAINT "CapitalInterest_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "MarketListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapitalInterest" ADD CONSTRAINT "CapitalInterest_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
