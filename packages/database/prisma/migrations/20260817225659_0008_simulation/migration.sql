-- CreateEnum
CREATE TYPE "SimulationScenarioKind" AS ENUM ('PORT_CLOSURE', 'SUPPLY_CHAIN_DISRUPTION', 'COMMODITY_SHOCK', 'WEATHER', 'INFRASTRUCTURE_FAILURE', 'COUNTERPARTY_FAILURE', 'GEOPOLITICAL', 'CYBER');

-- CreateTable
CREATE TABLE "SimulationRun" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "scenarioKind" "SimulationScenarioKind" NOT NULL,
    "triggerNodeId" TEXT NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "severity" DOUBLE PRECISION NOT NULL,
    "description" TEXT,
    "currency" CHAR(3) NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimulationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SimulationRun_organisationId_createdAt_idx" ON "SimulationRun"("organisationId", "createdAt");

-- AddForeignKey
ALTER TABLE "SimulationRun" ADD CONSTRAINT "SimulationRun_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
