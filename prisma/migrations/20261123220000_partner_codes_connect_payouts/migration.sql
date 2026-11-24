-- Commissioner Partner Codes: Stripe Connect payouts. Additive: nullable columns, a unique index on a
-- new nullable column, and settings/counters with defaults.

-- AlterTable
ALTER TABLE "PartnerProgramSettings" ADD COLUMN     "autoSendMaxCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PartnerPayout" ADD COLUMN     "transferAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "transferError" TEXT;

-- AlterTable
ALTER TABLE "PartnerTaxProfile" ADD COLUMN     "stripeAccountId" TEXT,
ADD COLUMN     "stripeStatusCheckedAt" TIMESTAMP(3),
ADD COLUMN     "stripeTransfersStatus" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PartnerTaxProfile_stripeAccountId_key" ON "PartnerTaxProfile"("stripeAccountId");

