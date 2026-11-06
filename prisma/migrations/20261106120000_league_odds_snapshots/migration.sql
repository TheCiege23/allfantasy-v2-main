-- Season Outlook odds history: how each team's playoff and title odds moved week by week.
--
-- NOT APPLIED. Written with the code that uses it; applying it to production is the owner's call.
-- The code is safe either way: every read and write is raw SQL inside a catch, and a missing table
-- (42P01) reads as "no history" (no chart) and writes as a no-op.
--
-- One row per team per league-week. `league_id` is the Season Outlook scope key (`sleeper:<id>`,
-- `native:<uuid>` — see `weeklyScopeKey`), the id the stored simulation is keyed on; `team_external_id`
-- the platform roster id. Written by lib/core-app/seasonOutlookOddsHistory.ts with INSERT … ON CONFLICT
-- DO UPDATE, so re-running a week overwrites it in place. The writer keeps the current and previous
-- season per league and deletes older seasons.
--
-- Additive only: one new table and its unique index. No change to any existing table, no backfill,
-- no long lock. The unique index also serves the one read (league, season, team → weeks).

CREATE TABLE IF NOT EXISTS "league_odds_snapshots" (
  "id"               TEXT NOT NULL,
  "league_id"        VARCHAR(128) NOT NULL,
  "season"           INTEGER NOT NULL,
  "week"             INTEGER NOT NULL,
  "team_external_id" VARCHAR(64) NOT NULL,
  "playoff_pct"      DOUBLE PRECISION NOT NULL,
  "title_pct"        DOUBLE PRECISION NOT NULL,
  "computed_at"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "league_odds_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "league_odds_snapshots_league_season_week_team_key"
  ON "league_odds_snapshots"("league_id", "season", "week", "team_external_id");
