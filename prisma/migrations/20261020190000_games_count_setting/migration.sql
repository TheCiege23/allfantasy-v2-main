-- CreateTable
CREATE TABLE "player_week_game_scores" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "gameId" VARCHAR(128) NOT NULL,
    "gameDay" DATE NOT NULL,
    "startTime" TIMESTAMP(3),
    "stats" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_week_game_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redraft_games_count_choices" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "rosterId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "playerId" VARCHAR(128) NOT NULL,
    "pickedGameIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lockedGameId" VARCHAR(128),
    "lockedAt" TIMESTAMP(3),
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "redraft_games_count_choices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "player_week_game_scores_sport_season_week_idx" ON "player_week_game_scores"("sport", "season", "week");

-- CreateIndex
CREATE INDEX "player_week_game_scores_playerId_sport_season_week_idx" ON "player_week_game_scores"("playerId", "sport", "season", "week");

-- CreateIndex
CREATE UNIQUE INDEX "player_week_game_scores_playerId_sport_season_gameId_key" ON "player_week_game_scores"("playerId", "sport", "season", "gameId");

-- CreateIndex
CREATE INDEX "redraft_games_count_choices_leagueId_season_week_idx" ON "redraft_games_count_choices"("leagueId", "season", "week");

-- CreateIndex
CREATE UNIQUE INDEX "redraft_games_count_choices_rosterId_season_week_playerId_key" ON "redraft_games_count_choices"("rosterId", "season", "week", "playerId");

