-- CreateTable
CREATE TABLE "CapitalCommitment" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "committedMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapitalCommitment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CapitalCommitment_organisationId_key" ON "CapitalCommitment"("organisationId");

-- AddForeignKey
ALTER TABLE "CapitalCommitment" ADD CONSTRAINT "CapitalCommitment_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
