-- Future-week NFL projections (2026-09-29). Two new, empty tables: nothing existing is altered.
--
-- 🛑 DELIBERATELY NOT `fantasy_projections`. Every current-week reader takes that table's most
-- recently fetched week as "the current week" (`latestProjectionWeek()` in
-- lib/core-app/playerProjections.ts), so a future week written there would hijack My Team, matchups,
-- waivers, player cards and Chimmy's lineup tools. Future weeks live here, where no current-week
-- reader looks.
--
-- The code ships before this is applied and does nothing until it is: the ingestion phase in
-- /api/cron/import-projections and the reader both ask `futureWeekProjectionsReady()` first, which
-- probes information_schema and re-checks every 10 minutes, so applying this takes effect without a
-- deploy.

-- One projected line per (player, future week), as Sleeper's board published it.
CREATE TABLE IF NOT EXISTS "future_week_projections" (
    "id" TEXT NOT NULL,
    "sport" VARCHAR(16) NOT NULL,
    "season" VARCHAR(8) NOT NULL,
    "week" INTEGER NOT NULL,
    "player_id" VARCHAR(64) NOT NULL,
    "scoring_preset_id" VARCHAR(32) NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "projected_points" DOUBLE PRECISION NOT NULL,
    "stats" JSONB NOT NULL,
    "opponent" VARCHAR(8),
    "anchor_week" INTEGER NOT NULL,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "future_week_projections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "future_week_projections_uniq" ON "future_week_projections"("sport", "season", "week", "player_id", "scoring_preset_id", "source");
CREATE INDEX IF NOT EXISTS "future_week_projections_week_idx" ON "future_week_projections"("sport", "season", "week");
CREATE INDEX IF NOT EXISTS "future_week_projections_player_idx" ON "future_week_projections"("player_id");

-- One row per (future week) saying what we last learned about it, so a missing line can be told
-- apart: "Sleeper had not published this week when we asked at T" vs "we never asked".
CREATE TABLE IF NOT EXISTS "future_week_projection_checks" (
    "id" TEXT NOT NULL,
    "sport" VARCHAR(16) NOT NULL,
    "season" VARCHAR(8) NOT NULL,
    "week" INTEGER NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    -- Outcome of the last SUCCESSFUL check: 'published' | 'not_published'. NULL = never succeeded.
    "status" VARCHAR(16),
    "row_count" INTEGER NOT NULL DEFAULT 0,
    -- sha256 of the canonical board; an equal hash skips every row write.
    "payload_hash" VARCHAR(64),
    "anchor_week" INTEGER NOT NULL,
    -- Last attempt, successful or not.
    "checked_at" TIMESTAMPTZ(6) NOT NULL,
    -- Last time a successful fetch confirmed what is stored. The as-of for every value served.
    "confirmed_at" TIMESTAMPTZ(6),
    -- Last time the published lines actually changed (rows rewritten).
    "changed_at" TIMESTAMPTZ(6),
    "last_error" VARCHAR(240),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "future_week_projection_checks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "future_week_projection_checks_uniq" ON "future_week_projection_checks"("sport", "season", "week", "source");
