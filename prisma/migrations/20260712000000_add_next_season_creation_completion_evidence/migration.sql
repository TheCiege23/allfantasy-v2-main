-- Additive: immutable completion evidence for atomic next-season creation.
-- LeagueRenewal already carries nextSeasonId/nextSeason/completedAt from the
-- renewal-foundation migrations; this adds the settings/scoring snapshot
-- (a real, versioned copy of League.settings taken at renewal time, not a
-- new versioning system) plus stable idempotency/event/audit identity so a
-- completed renewal is reconstructable and its completion is retry-safe.
ALTER TABLE "league_renewals" ADD COLUMN "settingsSnapshot" JSONB;
ALTER TABLE "league_renewals" ADD COLUMN "settingsSnapshotVersion" INTEGER;
ALTER TABLE "league_renewals" ADD COLUMN "rosterCount" INTEGER;
ALTER TABLE "league_renewals" ADD COLUMN "managerAssignmentCount" INTEGER;
ALTER TABLE "league_renewals" ADD COLUMN "completionIdempotencyKey" TEXT;
ALTER TABLE "league_renewals" ADD COLUMN "completionEventId" TEXT;
ALTER TABLE "league_renewals" ADD COLUMN "completionAuditId" TEXT;
ALTER TABLE "league_renewals" ADD COLUMN "sourceSeasonId" TEXT;

CREATE UNIQUE INDEX "league_renewals_completionIdempotencyKey_key" ON "league_renewals"("completionIdempotencyKey");
CREATE UNIQUE INDEX "league_renewals_completionEventId_key" ON "league_renewals"("completionEventId");
