-- Daily lineups for NBA / NHL / MLB (docs/DAILY_LINEUPS_DESIGN.md §6). Additive: two new tables,
-- no existing column or key changes. Read and written only for leagues with
-- sportConfig.dailyLineupsEnabled = true, which nothing sets by default.

CREATE TABLE IF NOT EXISTS "redraft_daily_lineups" (
  "id"         TEXT         NOT NULL,
  "leagueId"   TEXT         NOT NULL,
  "rosterId"   TEXT         NOT NULL,
  "season"     INTEGER      NOT NULL,
  "week"       INTEGER      NOT NULL,
  "scoringDay" DATE         NOT NULL,
  "playerId"   VARCHAR(128) NOT NULL,
  "slotType"   VARCHAR(32)  NOT NULL,
  "source"     VARCHAR(32)  NOT NULL DEFAULT 'user',
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "redraft_daily_lineups_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "redraft_daily_lineups_rosterId_scoringDay_playerId_key"
  ON "redraft_daily_lineups" ("rosterId", "scoringDay", "playerId");
CREATE INDEX IF NOT EXISTS "redraft_daily_lineups_leagueId_season_week_idx"
  ON "redraft_daily_lineups" ("leagueId", "season", "week");
CREATE INDEX IF NOT EXISTS "redraft_daily_lineups_rosterId_season_week_idx"
  ON "redraft_daily_lineups" ("rosterId", "season", "week");
ALTER TABLE "redraft_daily_lineups"
  ADD CONSTRAINT "redraft_daily_lineups_rosterId_fkey"
  FOREIGN KEY ("rosterId") REFERENCES "redraft_rosters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "player_daily_scores" (
  "id"           TEXT         NOT NULL,
  "playerId"     TEXT         NOT NULL,
  "sport"        TEXT         NOT NULL,
  "season"       INTEGER      NOT NULL,
  "week"         INTEGER      NOT NULL,
  "scoringDay"   DATE         NOT NULL,
  "stats"        JSONB        NOT NULL,
  "gamesPlayed"  INTEGER      NOT NULL DEFAULT 0,
  "gamesStarted" INTEGER      NOT NULL DEFAULT 0,
  "inningsOuts"  INTEGER,
  "isFinalized"  BOOLEAN      NOT NULL DEFAULT false,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "player_daily_scores_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "player_daily_scores_playerId_sport_season_scoringDay_key"
  ON "player_daily_scores" ("playerId", "sport", "season", "scoringDay");
CREATE INDEX IF NOT EXISTS "player_daily_scores_sport_season_week_idx"
  ON "player_daily_scores" ("sport", "season", "week");
