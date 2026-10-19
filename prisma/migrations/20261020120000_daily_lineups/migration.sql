-- Daily lineups for MLB/NBA/NHL (docs/DAILY_LINEUPS_DESIGN.md §6). Additive: no existing column or key changes.

-- CreateTable
CREATE TABLE "redraft_daily_lineups" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "rosterId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "scoringDay" DATE NOT NULL,
    "playerId" VARCHAR(128) NOT NULL,
    "slotType" VARCHAR(32) NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "source" VARCHAR(32) NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "redraft_daily_lineups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_daily_scores" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "scoringDay" DATE NOT NULL,
    "stats" JSONB NOT NULL,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "gamesStarted" INTEGER NOT NULL DEFAULT 0,
    "inningsOuts" INTEGER,
    "isFinalized" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_daily_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "redraft_daily_lineups_leagueId_season_week_idx" ON "redraft_daily_lineups"("leagueId", "season", "week");

-- CreateIndex
CREATE INDEX "redraft_daily_lineups_rosterId_season_week_idx" ON "redraft_daily_lineups"("rosterId", "season", "week");

-- CreateIndex
CREATE UNIQUE INDEX "redraft_daily_lineups_rosterId_scoringDay_playerId_key" ON "redraft_daily_lineups"("rosterId", "scoringDay", "playerId");

-- CreateIndex
CREATE INDEX "player_daily_scores_sport_season_week_idx" ON "player_daily_scores"("sport", "season", "week");

-- CreateIndex
CREATE UNIQUE INDEX "player_daily_scores_playerId_sport_season_scoringDay_key" ON "player_daily_scores"("playerId", "sport", "season", "scoringDay");

-- AddForeignKey
ALTER TABLE "redraft_daily_lineups" ADD CONSTRAINT "redraft_daily_lineups_rosterId_fkey" FOREIGN KEY ("rosterId") REFERENCES "redraft_rosters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
