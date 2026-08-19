-- Decision OS Phase A Increment 5 — provider-neutral behavioral snapshot trend history.
-- Apply to a NON-PRODUCTION database only (Neon branch or local dev). Never to production.
-- Idempotency is enforced by the UNIQUE index on ("leagueId","managerId","periodKey").
-- managerId uses the non-null sentinel '__league__' for league-scope rows (see model doc comment
-- in schema.prisma) so the unique index actually enforces convergence for those rows in Postgres.

-- CreateTable
CREATE TABLE "decision_os_behavioral_snapshot" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL DEFAULT '__league__',
    "scope" TEXT NOT NULL,
    "cadence" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "lookbackDays" INTEGER,
    "eventCount" INTEGER NOT NULL,
    "completeness" INTEGER NOT NULL,
    "facts" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "decision_os_behavioral_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "decision_os_behavioral_snapshot_leagueId_managerId_periodKey_key" ON "decision_os_behavioral_snapshot"("leagueId", "managerId", "periodKey");

-- CreateIndex
CREATE INDEX "decision_os_behavioral_snapshot_leagueId_scope_periodKey_idx" ON "decision_os_behavioral_snapshot"("leagueId", "scope", "periodKey");

-- CreateIndex
CREATE INDEX "decision_os_behavioral_snapshot_leagueId_managerId_capture_idx" ON "decision_os_behavioral_snapshot"("leagueId", "managerId", "capturedAt");
