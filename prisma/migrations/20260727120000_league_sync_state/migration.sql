-- Launch Batch 2 — durable Sleeper read-model synchronization state.
-- One row per deterministic run key (`<provider>:<externalLeagueId>:<season>`): a single
-- external league+season the scheduled collector keeps fresh, independent of how many
-- AllFantasy `leagues` rows (one per importing user) mirror it. Backs the durable runner's
-- SyncStore (per-scope checkpoints + certified freshness). Read-only mirror — no credentials.
--
-- Purely additive. `IF NOT EXISTS` throughout so it is a safe no-op on any environment where
-- the table already exists (this prod-derived DB's _prisma_migrations is applied via raw SQL).
CREATE TABLE IF NOT EXISTS "league_sync_state" (
    "id" TEXT NOT NULL,
    "runKey" VARCHAR(191) NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "externalLeagueId" VARCHAR(128) NOT NULL,
    "season" INTEGER NOT NULL,
    "sport" VARCHAR(16) NOT NULL DEFAULT 'NFL',
    "seasonState" VARCHAR(24),
    "syncStatus" VARCHAR(24),
    "checkpoints" JSONB NOT NULL DEFAULT '{}',
    "completedScopes" JSONB NOT NULL DEFAULT '[]',
    "incompleteScopes" JSONB NOT NULL DEFAULT '[]',
    "lastRunAccounting" JSONB,
    "lastAttemptedSyncAt" TIMESTAMP(3),
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "sourceDataTimestamp" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastRunId" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "league_sync_state_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "league_sync_state_runKey_key" ON "league_sync_state"("runKey");
CREATE INDEX IF NOT EXISTS "league_sync_state_provider_externalLeagueId_season_idx" ON "league_sync_state"("provider", "externalLeagueId", "season");
CREATE INDEX IF NOT EXISTS "league_sync_state_lastSuccessfulSyncAt_idx" ON "league_sync_state"("lastSuccessfulSyncAt");
CREATE INDEX IF NOT EXISTS "league_sync_state_lastAttemptedSyncAt_idx" ON "league_sync_state"("lastAttemptedSyncAt");
