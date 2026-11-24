-- Commissioner Partner Codes. Additive only: eight new tables, no existing table touched.
-- See docs/partner-codes/README.md.

-- CreateTable
CREATE TABLE "PartnerProgramSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "discountPercent" INTEGER NOT NULL DEFAULT 10,
    "discountMonths" INTEGER NOT NULL DEFAULT 3,
    "yearlyDiscountMode" TEXT NOT NULL DEFAULT 'prorated',
    "commissionPercent" INTEGER NOT NULL DEFAULT 10,
    "commissionBasis" TEXT NOT NULL DEFAULT 'net',
    "commissionCapMonths" INTEGER,
    "cashThresholdPaidSubs" INTEGER NOT NULL DEFAULT 10,
    "freeSupremePaidSubs" INTEGER NOT NULL DEFAULT 10,
    "freeCommissionerActiveUsers" INTEGER NOT NULL DEFAULT 15,
    "freeSupremeActiveUsers" INTEGER NOT NULL DEFAULT 50,
    "rewardHoldDays" INTEGER NOT NULL DEFAULT 30,
    "rewardGraceDays" INTEGER NOT NULL DEFAULT 30,
    "activeMinDays" INTEGER NOT NULL DEFAULT 4,
    "activeWindowDays" INTEGER NOT NULL DEFAULT 28,
    "paymentClearDays" INTEGER NOT NULL DEFAULT 30,
    "minPayoutCents" INTEGER NOT NULL DEFAULT 2500,
    "maxCodeChangesPerYear" INTEGER NOT NULL DEFAULT 2,
    "stripeMonthlyCouponId" TEXT,
    "stripeYearlyCouponIds" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "PartnerProgramSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerCode" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "codeNormalized" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "cashUnlockedAt" TIMESTAMP(3),
    "freePlan" TEXT NOT NULL DEFAULT 'none',
    "rewardLevels" JSONB,
    "paidSubsCount" INTEGER NOT NULL DEFAULT 0,
    "activeUsersCount" INTEGER NOT NULL DEFAULT 0,
    "pendingPaidCount" INTEGER NOT NULL DEFAULT 0,
    "metersUpdatedAt" TIMESTAMP(3),
    "shareLook" TEXT NOT NULL DEFAULT 'midnight',
    "shareLogo" TEXT NOT NULL DEFAULT 'initials',
    "logoUrl" TEXT,
    "logoStatus" TEXT NOT NULL DEFAULT 'none',
    "codeChangedAt" TIMESTAMP(3)[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerCodeAlias" (
    "codeNormalized" TEXT NOT NULL,
    "partnerCodeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerCodeAlias_pkey" PRIMARY KEY ("codeNormalized")
);

-- CreateTable
CREATE TABLE "PartnerReferral" (
    "id" TEXT NOT NULL,
    "partnerCodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'web',
    "plan" TEXT,
    "interval" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "flagReasons" TEXT[],
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "storeOriginalTxnId" TEXT,
    "cardFingerprint" TEXT,
    "signupIp" TEXT,
    "emailDomain" TEXT,
    "currentlyPaying" BOOLEAN NOT NULL DEFAULT false,
    "firstPaidAt" TIMESTAMP(3),
    "qualifiedAt" TIMESTAMP(3),
    "churnedAt" TIMESTAMP(3),
    "paidInvoiceCount" INTEGER NOT NULL DEFAULT 0,
    "seenPaymentRefs" TEXT[],
    "commissionMonths" INTEGER NOT NULL DEFAULT 0,
    "activeDaysInWindow" INTEGER NOT NULL DEFAULT 0,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerReferral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerReferralActivity" (
    "referralId" TEXT NOT NULL,
    "day" DATE NOT NULL,

    CONSTRAINT "PartnerReferralActivity_pkey" PRIMARY KEY ("referralId","day")
);

-- CreateTable
CREATE TABLE "PartnerCommissionEntry" (
    "id" TEXT NOT NULL,
    "partnerCodeId" TEXT NOT NULL,
    "referralId" TEXT,
    "source" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "installment" INTEGER NOT NULL DEFAULT 0,
    "periodMonth" TEXT NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL,
    "grossCents" INTEGER NOT NULL DEFAULT 0,
    "feeCents" INTEGER NOT NULL DEFAULT 0,
    "refundCents" INTEGER NOT NULL DEFAULT 0,
    "basisCents" INTEGER NOT NULL DEFAULT 0,
    "commissionMillicents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'accrued',
    "payoutId" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerCommissionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerPayout" (
    "id" TEXT NOT NULL,
    "partnerCodeId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "periodMonth" TEXT NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_review',
    "heldReason" TEXT,
    "method" TEXT,
    "externalRef" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "paidAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerTaxProfile" (
    "ownerUserId" TEXT NOT NULL,
    "w9Status" TEXT NOT NULL DEFAULT 'missing',
    "payoutMethod" TEXT,
    "legalName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerTaxProfile_pkey" PRIMARY KEY ("ownerUserId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerCode_ownerUserId_key" ON "PartnerCode"("ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerCode_codeNormalized_key" ON "PartnerCode"("codeNormalized");

-- CreateIndex
CREATE INDEX "PartnerCode_status_idx" ON "PartnerCode"("status");

-- CreateIndex
CREATE INDEX "PartnerCodeAlias_partnerCodeId_idx" ON "PartnerCodeAlias"("partnerCodeId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerReferral_userId_key" ON "PartnerReferral"("userId");

-- CreateIndex
CREATE INDEX "PartnerReferral_partnerCodeId_status_idx" ON "PartnerReferral"("partnerCodeId", "status");

-- CreateIndex
CREATE INDEX "PartnerReferral_stripeSubscriptionId_idx" ON "PartnerReferral"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "PartnerReferral_stripeCustomerId_idx" ON "PartnerReferral"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "PartnerReferral_cardFingerprint_idx" ON "PartnerReferral"("cardFingerprint");

-- CreateIndex
CREATE INDEX "PartnerReferral_partnerCodeId_signupIp_createdAt_idx" ON "PartnerReferral"("partnerCodeId", "signupIp", "createdAt");

-- CreateIndex
CREATE INDEX "PartnerCommissionEntry_partnerCodeId_status_earnedAt_idx" ON "PartnerCommissionEntry"("partnerCodeId", "status", "earnedAt");

-- CreateIndex
CREATE INDEX "PartnerCommissionEntry_referralId_idx" ON "PartnerCommissionEntry"("referralId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerCommissionEntry_source_sourceRef_installment_key" ON "PartnerCommissionEntry"("source", "sourceRef", "installment");

-- CreateIndex
CREATE INDEX "PartnerPayout_status_idx" ON "PartnerPayout"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerPayout_partnerCodeId_periodMonth_key" ON "PartnerPayout"("partnerCodeId", "periodMonth");

-- AddForeignKey
ALTER TABLE "PartnerCodeAlias" ADD CONSTRAINT "PartnerCodeAlias_partnerCodeId_fkey" FOREIGN KEY ("partnerCodeId") REFERENCES "PartnerCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerReferral" ADD CONSTRAINT "PartnerReferral_partnerCodeId_fkey" FOREIGN KEY ("partnerCodeId") REFERENCES "PartnerCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerReferralActivity" ADD CONSTRAINT "PartnerReferralActivity_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "PartnerReferral"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerCommissionEntry" ADD CONSTRAINT "PartnerCommissionEntry_partnerCodeId_fkey" FOREIGN KEY ("partnerCodeId") REFERENCES "PartnerCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerCommissionEntry" ADD CONSTRAINT "PartnerCommissionEntry_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "PartnerReferral"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerCommissionEntry" ADD CONSTRAINT "PartnerCommissionEntry_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "PartnerPayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerPayout" ADD CONSTRAINT "PartnerPayout_partnerCodeId_fkey" FOREIGN KEY ("partnerCodeId") REFERENCES "PartnerCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

