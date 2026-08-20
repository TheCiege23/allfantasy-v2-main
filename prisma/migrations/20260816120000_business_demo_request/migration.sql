-- CreateTable
CREATE TABLE "BusinessDemoRequest" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "company" TEXT,
    "name" TEXT,
    "useCase" TEXT,
    "source" TEXT DEFAULT 'allfantasy.ai',
    "referrer" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "utmMedium" TEXT,
    "utmSource" TEXT,
    "utmTerm" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessDemoRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessDemoRequest_createdAt_idx" ON "BusinessDemoRequest"("createdAt");

-- CreateIndex
CREATE INDEX "BusinessDemoRequest_status_idx" ON "BusinessDemoRequest"("status");

-- CreateIndex
-- NOTE: index, NOT a unique constraint. The same buyer may legitimately ask twice,
-- and a unique email here would turn a second request into a dropped lead.
CREATE INDEX "BusinessDemoRequest_email_idx" ON "BusinessDemoRequest"("email");
