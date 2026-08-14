/*
  Warnings:

  - Added the required column `durationDays` to the `MarketListing` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "MarketListing" ADD COLUMN     "durationDays" INTEGER NOT NULL;
