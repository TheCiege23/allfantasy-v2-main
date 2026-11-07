-- Lineup lock snapshots: what each manager could see (projection, injury status, bye) when each of
-- his players' games kicked off, one row per team per week. Written hourly by
-- lib/integrity/lineupLockSnapshots.ts and scored at week close by lib/integrity/lineupIntegrityScore.ts.
-- Code ships ahead of this migration: the writer and every read skip while the table is absent, so
-- applying it only turns the Lineup Integrity score on. Additive; no existing table is touched.

-- CreateTable
CREATE TABLE "lineup_lock_snapshots" (
    "id" TEXT NOT NULL,
    "league_id" TEXT NOT NULL,
    "roster_id" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "players" JSONB NOT NULL,
    "slots" JSONB NOT NULL,
    "started_proj" DOUBLE PRECISION,
    "optimal_proj" DOUBLE PRECISION,
    "ratio" DOUBLE PRECISION,
    "started_top_count" INTEGER,
    "starter_count" INTEGER,
    "excluded_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "skip_reason" TEXT,
    "scored_at" TIMESTAMP(3),
    "algorithm_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lineup_lock_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lineup_lock_snapshots_league_id_roster_id_season_week_key" ON "lineup_lock_snapshots"("league_id", "roster_id", "season", "week");

-- CreateIndex
CREATE INDEX "lineup_lock_snapshots_league_id_season_week_idx" ON "lineup_lock_snapshots"("league_id", "season", "week");
