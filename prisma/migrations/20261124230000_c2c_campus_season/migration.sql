-- C2C separate standings (owner's decision, 2026-11-24): the college side's own season, matchups and
-- standings. Additive only: three new tables, nothing existing is altered, so code reading existing
-- tables is unaffected if it deploys before this migration.

-- CreateTable
CREATE TABLE "c2c_campus_seasons" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "redraftSeasonId" TEXT NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'regular',
    "regularSeasonWeeks" INTEGER NOT NULL,
    "playoffTeams" INTEGER NOT NULL DEFAULT 0,
    "championRosterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "c2c_campus_seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "c2c_campus_matchups" (
    "id" TEXT NOT NULL,
    "campusSeasonId" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "homeRosterId" TEXT NOT NULL,
    "awayRosterId" TEXT,
    "homeScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "awayScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" VARCHAR(16) NOT NULL DEFAULT 'scheduled',
    "kind" VARCHAR(16) NOT NULL DEFAULT 'regular',
    "playoffRound" INTEGER,
    "bracketSlot" INTEGER,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "c2c_campus_matchups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "c2c_campus_standings" (
    "id" TEXT NOT NULL,
    "campusSeasonId" TEXT NOT NULL,
    "rosterId" TEXT NOT NULL,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "ties" INTEGER NOT NULL DEFAULT 0,
    "medianWins" INTEGER NOT NULL DEFAULT 0,
    "medianLosses" INTEGER NOT NULL DEFAULT 0,
    "medianTies" INTEGER NOT NULL DEFAULT 0,
    "pointsFor" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pointsAgainst" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rank" INTEGER,
    "seed" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "c2c_campus_standings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "c2c_campus_seasons_leagueId_season_key" ON "c2c_campus_seasons"("leagueId", "season");

-- CreateIndex
CREATE INDEX "c2c_campus_matchups_campusSeasonId_week_idx" ON "c2c_campus_matchups"("campusSeasonId", "week");

-- CreateIndex
CREATE UNIQUE INDEX "c2c_campus_standings_campusSeasonId_rosterId_key" ON "c2c_campus_standings"("campusSeasonId", "rosterId");

-- AddForeignKey
ALTER TABLE "c2c_campus_seasons" ADD CONSTRAINT "c2c_campus_seasons_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "c2c_campus_matchups" ADD CONSTRAINT "c2c_campus_matchups_campusSeasonId_fkey" FOREIGN KEY ("campusSeasonId") REFERENCES "c2c_campus_seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "c2c_campus_standings" ADD CONSTRAINT "c2c_campus_standings_campusSeasonId_fkey" FOREIGN KEY ("campusSeasonId") REFERENCES "c2c_campus_seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

