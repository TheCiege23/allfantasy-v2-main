-- Pre-game win odds, saved — shareable moments / weekly upsets (user decision 2026-09-14:
-- "Weekly upsets (saves odds first)").
--
-- 🛑 PARKED. This lives in prisma/migrations-pending/ because applying it to production is the
-- user's call. Move it to prisma/migrations/ only as part of that authorised apply (see this
-- directory's README for why the directory, not git, is the deploy path).
--
-- One row per roster per league-week: the win probability the week board's model gave that roster
-- BEFORE the week was played, with both sides' projected points and sample sizes. A later "won as a
-- 22% underdog" is read from here — it cannot be rebuilt afterwards, because once the week is scored
-- it joins the history and the same model returns a different number.
--
-- `league_id` is the PLATFORM league id (the WeeklyMatchup id space), `roster_id` the platform
-- roster id. Written once per league-week by lib/core-app/matchupOddsSweep.ts (the domain-os-refresh
-- cron), only while that week is entirely unplayed and never Sunday–Tuesday 06:00 ET; ON CONFLICT DO
-- NOTHING keeps the first capture. `model` names the formula so a future model never mixes silently.
--
-- Additive only: one new table, one unique index, one lookup index. No change to any existing table,
-- no backfill, no long lock. The sweep reads this table first and treats a missing table (42P01) as
-- "unavailable", doing no other work — safe to apply before or after the code. No Prisma model until
-- applied, so the schema-drift guard never sees a model without its table.

CREATE TABLE IF NOT EXISTS "matchup_odds_snapshots" (
  "id"                        TEXT NOT NULL,
  "league_id"                 VARCHAR(64) NOT NULL,
  "season"                    INTEGER NOT NULL,
  "week"                      INTEGER NOT NULL,
  "roster_id"                 VARCHAR(64) NOT NULL,
  "opponent_roster_id"        VARCHAR(64) NOT NULL,
  "projected_points"          DOUBLE PRECISION NOT NULL,
  "opponent_projected_points" DOUBLE PRECISION NOT NULL,
  "win_probability"           DOUBLE PRECISION NOT NULL,
  "sample_weeks"              INTEGER NOT NULL,
  "opponent_sample_weeks"     INTEGER NOT NULL,
  "model"                     VARCHAR(40) NOT NULL,
  "captured_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "matchup_odds_snapshots_pkey" PRIMARY KEY ("id")
);

-- One capture per roster per league-week; the sweep's ON CONFLICT DO NOTHING relies on it.
CREATE UNIQUE INDEX IF NOT EXISTS "matchup_odds_snapshots_league_season_week_roster_key"
  ON "matchup_odds_snapshots"("league_id", "season", "week", "roster_id");

-- The sweep's due read (one season) and the later upset reader (a played week).
CREATE INDEX IF NOT EXISTS "matchup_odds_snapshots_season_week_idx"
  ON "matchup_odds_snapshots"("season", "week");
