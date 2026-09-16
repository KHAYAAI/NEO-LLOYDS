-- AlterTable: the account a settlement transaction actually pays out to
-- (e.g. a Stripe Connect account id). Nullable -- everything settled
-- before this column existed, and any settlement without a configured
-- destination, has none.
ALTER TABLE "SettlementTransaction" ADD COLUMN "destinationAccountId" TEXT;
