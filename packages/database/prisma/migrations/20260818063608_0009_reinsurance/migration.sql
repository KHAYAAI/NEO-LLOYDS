-- CreateEnum
CREATE TYPE "ReinsuranceLayerKind" AS ENUM ('QUOTA_SHARE', 'EXCESS_OF_LOSS', 'AGGREGATE');

-- CreateTable
CREATE TABLE "ReinsuranceProgram" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReinsuranceProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReinsuranceLayer" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "kind" "ReinsuranceLayerKind" NOT NULL,
    "params" JSONB NOT NULL,
    "aggregateConsumedGrossMinor" BIGINT NOT NULL DEFAULT 0,
    "aggregateConsumedCededMinor" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "ReinsuranceLayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReinsuranceCession" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "claimId" TEXT,
    "grossLossMinor" BIGINT NOT NULL,
    "totalCededMinor" BIGINT NOT NULL,
    "netRetainedMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "perLayer" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReinsuranceCession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReinsuranceProgram_organisationId_idx" ON "ReinsuranceProgram"("organisationId");

-- CreateIndex
CREATE INDEX "ReinsuranceLayer_programId_idx" ON "ReinsuranceLayer"("programId");

-- CreateIndex
CREATE UNIQUE INDEX "ReinsuranceLayer_programId_order_key" ON "ReinsuranceLayer"("programId", "order");

-- CreateIndex
CREATE INDEX "ReinsuranceCession_programId_createdAt_idx" ON "ReinsuranceCession"("programId", "createdAt");

-- CreateIndex
CREATE INDEX "ReinsuranceCession_claimId_idx" ON "ReinsuranceCession"("claimId");

-- AddForeignKey
ALTER TABLE "ReinsuranceProgram" ADD CONSTRAINT "ReinsuranceProgram_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReinsuranceLayer" ADD CONSTRAINT "ReinsuranceLayer_programId_fkey" FOREIGN KEY ("programId") REFERENCES "ReinsuranceProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReinsuranceCession" ADD CONSTRAINT "ReinsuranceCession_programId_fkey" FOREIGN KEY ("programId") REFERENCES "ReinsuranceProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;
