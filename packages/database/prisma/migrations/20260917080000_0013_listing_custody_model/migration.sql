-- CreateEnum
CREATE TYPE "CustodyModel" AS ENUM ('CUSTODIAL', 'NON_CUSTODIAL');

-- AlterTable: every listing now discloses whether the capital behind it
-- is held by an intermediary in transit (CUSTODIAL -- Stripe Connect
-- Transfers today) or moves with no intermediary custody
-- (NON_CUSTODIAL). Existing rows default to CUSTODIAL: the model every
-- listing implicitly used before this column existed.
ALTER TABLE "MarketListing" ADD COLUMN "custodyModel" "CustodyModel" NOT NULL DEFAULT 'CUSTODIAL';

-- AlterTable: empty means "no preference, accepts either" -- same
-- convention as preferredRiskClasses/preferredJurisdictions on this table.
ALTER TABLE "CapitalAppetiteProfile" ADD COLUMN "acceptedCustodyModels" "CustodyModel"[] NOT NULL DEFAULT ARRAY[]::"CustodyModel"[];
