-- CreateEnum
CREATE TYPE "SettlementMethodKind" AS ENUM ('BANK_TRANSFER', 'DIGITAL_MONEY', 'STABLECOIN');

-- CreateEnum
CREATE TYPE "SettlementTransactionStatus" AS ENUM ('PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED');

-- CreateTable
CREATE TABLE "SettlementTransaction" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "claimPayoutOrganisationId" TEXT,
    "claimPayoutClaimId" TEXT,
    "method" "SettlementMethodKind" NOT NULL,
    "status" "SettlementTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "grossAmountMinor" BIGINT NOT NULL,
    "feeMinor" BIGINT NOT NULL,
    "netAmountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "providerRef" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SettlementTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SettlementTransaction_organisationId_createdAt_idx" ON "SettlementTransaction"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "SettlementTransaction_claimPayoutClaimId_idx" ON "SettlementTransaction"("claimPayoutClaimId");

-- AddForeignKey
ALTER TABLE "SettlementTransaction" ADD CONSTRAINT "SettlementTransaction_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
