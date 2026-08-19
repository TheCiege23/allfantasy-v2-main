CREATE TABLE IF NOT EXISTS "TeamTendencySeason" (
    "id" TEXT NOT NULL,
    "teamId" VARCHAR(8) NOT NULL,
    "season" INTEGER NOT NULL,
    "neutralPlays" INTEGER NOT NULL DEFAULT 0,
    "proe" DOUBLE PRECISION,
    "proeN" INTEGER,
    "shotgunRate" DOUBLE PRECISION,
    "shotgunN" INTEGER,
    "noHuddleRate" DOUBLE PRECISION,
    "noHuddleN" INTEGER,
    "secPerPlay" DOUBLE PRECISION,
    "secPerPlayN" INTEGER,
    "playActionRate" DOUBLE PRECISION,
    "playActionN" INTEGER,
    "motionRate" DOUBLE PRECISION,
    "motionN" INTEGER,
    "rpoRate" DOUBLE PRECISION,
    "rpoN" INTEGER,
    "screenRate" DOUBLE PRECISION,
    "screenN" INTEGER,
    "source" VARCHAR(32) NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeamTendencySeason_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TeamTendencySeason_teamId_season_key"
  ON "TeamTendencySeason"("teamId", "season");

CREATE INDEX IF NOT EXISTS "TeamTendencySeason_season_idx" ON "TeamTendencySeason"("season");
