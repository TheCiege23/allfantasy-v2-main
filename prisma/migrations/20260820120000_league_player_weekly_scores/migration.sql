-- Per-player weekly scoring for IMPORTED leagues, as the source platform scored it.
--
-- WHY A SECOND TABLE RATHER THAN REUSING `player_weekly_scores`
-- `player_weekly_scores` is unique on (playerId, week, season, sport) — global. That is the
-- right key for raw box stats and for our own model output: a rushing yard is a rushing yard
-- whoever's league it happened in. It is the WRONG key for imported actuals, because
-- Sleeper's `players_points` is already scored by that league's own settings. The same player
-- in a PPR league and a standard league has two different, equally true totals for the same
-- (player, week, season, sport). Writing both there means whichever league synced last wins,
-- and a manager in a standard league gets shown PPR numbers as their own. Silent, and wrong
-- in the direction that makes someone bench the right player.
--
-- WHY `player_id` IS PROVIDER-SPACE AND NOT A FOREIGN KEY
-- `SportsPlayer.sleeperId` bridges roughly 87% of NFL players. Resolving during ingestion
-- would discard the scores of everyone who fails to bridge; an FK would refuse to store them
-- at all. Keeping the provider id preserves the fact ("this player scored 12.4 in this league
-- this week") even before we can say who he is, and the read path already resolves sleeper ids
-- at render (lib/core-app/myTeam.ts). Same reasoning as LineupSlot.unresolvedId, which keeps
-- "we could not identify him" distinct from "nobody is there".
--
-- WHY `league_id` IS VARCHAR AND NOT AN FK EITHER
-- It carries the PLATFORM league id so it joins `weekly_matchups.league_id`, which is the same
-- space. Neither is our canonical League.id.
--
-- `is_finalized` DEFAULTS FALSE AND MUST NOT BE SET FROM THE GAME CLOCK
-- Stat corrections reprocess for ~12h after a game ends (contracts/rolling-insights,
-- `stat_corrections.reprocess_window_hours`). A score is still moving after the whistle, so
-- only a reconcile pass past that window may flip this.
CREATE TABLE "league_player_weekly_scores" (
    "id"           TEXT NOT NULL,
    "leagueId"     VARCHAR(64) NOT NULL,
    "seasonYear"   INTEGER NOT NULL,
    "week"         INTEGER NOT NULL,
    "playerId"     VARCHAR(64) NOT NULL,
    "rosterId"     INTEGER,
    "isStarter"    BOOLEAN NOT NULL DEFAULT false,
    "points"       DOUBLE PRECISION NOT NULL,
    "isFinalized"  BOOLEAN NOT NULL DEFAULT false,
    "source"       VARCHAR(16) NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "league_player_weekly_scores_pkey" PRIMARY KEY ("id")
);

-- The upsert key: one row per player per league-week.
CREATE UNIQUE INDEX "league_player_weekly_scores_leagueId_seasonYear_week_playerId_key"
    ON "league_player_weekly_scores"("leagueId", "seasonYear", "week", "playerId");

-- The read pattern: every consumer asks for one league-week at a time.
CREATE INDEX "league_player_weekly_scores_leagueId_seasonYear_week_idx"
    ON "league_player_weekly_scores"("leagueId", "seasonYear", "week");
