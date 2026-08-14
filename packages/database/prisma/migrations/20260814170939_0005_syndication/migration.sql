-- CreateTable
CREATE TABLE "Syndication" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "capacityMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "boundAt" TIMESTAMP(3),

    CONSTRAINT "Syndication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyndicationAllocation" (
    "id" TEXT NOT NULL,
    "syndicationId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "shareBps" INTEGER NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyndicationAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyndicationAllocationEvent" (
    "id" TEXT NOT NULL,
    "syndicationId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "shareBps" INTEGER NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "actorSubjectId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyndicationAllocationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Syndication_listingId_key" ON "Syndication"("listingId");

-- CreateIndex
CREATE INDEX "Syndication_organisationId_status_idx" ON "Syndication"("organisationId", "status");

-- CreateIndex
CREATE INDEX "SyndicationAllocation_syndicationId_idx" ON "SyndicationAllocation"("syndicationId");

-- CreateIndex
CREATE UNIQUE INDEX "SyndicationAllocation_syndicationId_organisationId_key" ON "SyndicationAllocation"("syndicationId", "organisationId");

-- CreateIndex
CREATE INDEX "SyndicationAllocationEvent_syndicationId_recordedAt_idx" ON "SyndicationAllocationEvent"("syndicationId", "recordedAt");

-- AddForeignKey
ALTER TABLE "Syndication" ADD CONSTRAINT "Syndication_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "MarketListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Syndication" ADD CONSTRAINT "Syndication_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyndicationAllocation" ADD CONSTRAINT "SyndicationAllocation_syndicationId_fkey" FOREIGN KEY ("syndicationId") REFERENCES "Syndication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyndicationAllocation" ADD CONSTRAINT "SyndicationAllocation_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyndicationAllocationEvent" ADD CONSTRAINT "SyndicationAllocationEvent_syndicationId_fkey" FOREIGN KEY ("syndicationId") REFERENCES "Syndication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
