-- Commissioner Partner Codes: the App Store / Google Play cut used as the fee on store purchases.
-- Additive, with a default: existing rows read 15.

-- AlterTable
ALTER TABLE "PartnerProgramSettings" ADD COLUMN     "storeFeePercent" INTEGER NOT NULL DEFAULT 15;

