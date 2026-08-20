-- Phase 7I staging draft SQL only (do not apply automatically).
-- Intent: add league-scoped weekly score table for correctness without switching consumers.
--
-- Staging apply (manual):
--   prisma db execute --file docs/sql/league-player-weekly-score-migration-draft.sql --schema prisma/schema.prisma
--
-- Prisma client types note:
--   npx prisma generate --schema prisma/schema.prisma --no-engine
--
-- Production prohibition:
--   Do not run this directly in production without explicit migration review/approval.

CREATE TABLE "league_player_weekly_scores" (
  "id" TEXT NOT NULL,
  "leagueId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "sport" TEXT NOT NULL,
  "week" INTEGER NOT NULL,
  "season" INTEGER NOT NULL,
  "fantasyPts" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "stats" JSONB,
  "isFinalized" BOOLEAN NOT NULL DEFAULT false,
  "source" TEXT NOT NULL DEFAULT 'rollup_pgs',
  "lineageJobName" TEXT,
  "rollupVersion" INTEGER,
  "scoringProfileId" TEXT,
  "scoringRulesHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "league_player_weekly_scores_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "league_player_weekly_scores_league_fkey" FOREIGN KEY ("leagueId") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "league_player_weekly_score_unique_key"
  ON "league_player_weekly_scores"("leagueId", "playerId", "week", "season", "sport");

CREATE INDEX "league_player_weekly_scores_league_season_week_idx"
  ON "league_player_weekly_scores"("leagueId", "season", "week");

CREATE INDEX "league_player_weekly_scores_player_season_week_sport_idx"
  ON "league_player_weekly_scores"("playerId", "season", "week", "sport");

CREATE INDEX "league_player_weekly_scores_league_updatedAt_idx"
  ON "league_player_weekly_scores"("leagueId", "updatedAt");

-- Rollback draft:
-- DROP TABLE IF EXISTS "league_player_weekly_scores";
-- Caveat: this removes all league-scoped weekly score data in the table.

