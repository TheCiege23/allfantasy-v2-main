-- Decision OS Phase A Increment 3 — provider-neutral imported/external-league activity.
-- Apply to a NON-PRODUCTION database only (Neon branch or local dev). Never to production.
-- Idempotency is enforced by the UNIQUE index on "externalSourceKey" (the normalizer's natural key).

-- CreateTable
CREATE TABLE "decision_os_imported_activity" (
    "id" TEXT NOT NULL,
    "externalSourceKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerLeagueId" TEXT NOT NULL,
    "afLeagueId" TEXT,
    "activityType" TEXT NOT NULL,
    "providerEventId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "externalManagerId" TEXT,
    "stableExternalManagerKey" TEXT,
    "appUserId" TEXT,
    "rosterId" TEXT,
    "payload" JSONB,
    "normalized" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "decision_os_imported_activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "decision_os_imported_activity_externalSourceKey_key" ON "decision_os_imported_activity"("externalSourceKey");

-- CreateIndex
CREATE INDEX "decision_os_imported_activity_afLeagueId_activityType_idx" ON "decision_os_imported_activity"("afLeagueId", "activityType");

-- CreateIndex
CREATE INDEX "decision_os_imported_activity_providerLeagueId_activityType_idx" ON "decision_os_imported_activity"("providerLeagueId", "activityType");

-- CreateIndex
CREATE INDEX "decision_os_imported_activity_occurredAt_idx" ON "decision_os_imported_activity"("occurredAt");
