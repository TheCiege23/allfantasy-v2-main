-- CreateTable: WorldCupSyncLog
-- Tracks automated and manual World Cup data sync runs for health/ops visibility.

CREATE TABLE "world_cup_sync_logs" (
    "id"                          TEXT NOT NULL,
    "status"                      VARCHAR(16) NOT NULL,
    "source"                      VARCHAR(32) NOT NULL,
    "started_at"                  TIMESTAMP(3) NOT NULL,
    "finished_at"                 TIMESTAMP(3),
    "teams_synced"                INTEGER NOT NULL DEFAULT 0,
    "fixtures_synced"             INTEGER NOT NULL DEFAULT 0,
    "matches_updated"             INTEGER NOT NULL DEFAULT 0,
    "brackets_updated"            INTEGER NOT NULL DEFAULT 0,
    "leaderboards_recalculated"   INTEGER NOT NULL DEFAULT 0,
    "summary"                     JSONB,
    "error_message"               TEXT,
    "created_at"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "world_cup_sync_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "world_cup_sync_logs_status_idx" ON "world_cup_sync_logs"("status");
CREATE INDEX "world_cup_sync_logs_created_at_idx" ON "world_cup_sync_logs"("created_at");
