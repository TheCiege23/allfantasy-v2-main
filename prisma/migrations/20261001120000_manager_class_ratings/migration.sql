-- Class ratings (ADR F2.10a, 2026-10-01). Two new, empty tables: nothing existing is altered.
-- `manager_ratings` holds one all-play Glicko-2 rating per platform person, sport and model version;
-- `manager_rating_events` is each person's league-week game log. Both are rebuilt from
-- `dw_matchup_facts` by the rating writer, which ships separately and must ask whether these
-- tables exist before it reads or writes — the code can land before this is applied.
-- CreateTable
CREATE TABLE IF NOT EXISTS "manager_ratings" (
    "id" TEXT NOT NULL,
    "subjectKey" VARCHAR(160) NOT NULL,
    "platform" VARCHAR(16) NOT NULL,
    "platformUserId" VARCHAR(128) NOT NULL,
    "userId" VARCHAR(64),
    "sport" VARCHAR(12) NOT NULL DEFAULT 'NFL',
    "modelVersion" VARCHAR(32) NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL,
    "rd" DOUBLE PRECISION NOT NULL,
    "volatility" DOUBLE PRECISION NOT NULL,
    "games" INTEGER NOT NULL,
    "established" BOOLEAN NOT NULL DEFAULT false,
    "percentile" DOUBLE PRECISION,
    "classLevel" INTEGER,
    "division" INTEGER,
    "lastPeriod" INTEGER,
    "computedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manager_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "manager_rating_events" (
    "id" TEXT NOT NULL,
    "subjectKey" VARCHAR(160) NOT NULL,
    "sport" VARCHAR(12) NOT NULL DEFAULT 'NFL',
    "modelVersion" VARCHAR(32) NOT NULL,
    "leagueId" VARCHAR(64) NOT NULL,
    "season" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "pointsFor" DOUBLE PRECISION NOT NULL,
    "allPlayWins" DOUBLE PRECISION NOT NULL,
    "allPlayGames" INTEGER NOT NULL,
    "opponentKey" VARCHAR(160),
    "pointsAgainst" DOUBLE PRECISION,
    "result" VARCHAR(1),
    "ratingBefore" DOUBLE PRECISION NOT NULL,
    "ratingAfter" DOUBLE PRECISION NOT NULL,
    "rdAfter" DOUBLE PRECISION NOT NULL,
    "ratingDelta" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manager_rating_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "manager_ratings_userId_sport_modelVersion_idx" ON "manager_ratings"("userId", "sport", "modelVersion");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "manager_ratings_sport_modelVersion_established_rating_idx" ON "manager_ratings"("sport", "modelVersion", "established", "rating");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "manager_ratings_subjectKey_sport_modelVersion_key" ON "manager_ratings"("subjectKey", "sport", "modelVersion");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "manager_rating_events_subjectKey_sport_modelVersion_season__idx" ON "manager_rating_events"("subjectKey", "sport", "modelVersion", "season", "week");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "manager_rating_events_leagueId_season_week_idx" ON "manager_rating_events"("leagueId", "season", "week");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "manager_rating_events_subjectKey_sport_modelVersion_leagueI_key" ON "manager_rating_events"("subjectKey", "sport", "modelVersion", "leagueId", "season", "week");

