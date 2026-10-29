-- Weekly Survivor loop: per-tribe weekly immunity winner and per-user seen moments.
CREATE TABLE IF NOT EXISTS "survivor_tribe_immunities" (
  "id" TEXT NOT NULL,
  "leagueId" VARCHAR(64) NOT NULL,
  "week" INTEGER NOT NULL,
  "tribeId" VARCHAR(64) NOT NULL,
  "immunityWinnerRosterId" VARCHAR(64) NOT NULL,
  "immunityWinnerUserId" VARCHAR(64) NOT NULL,
  "winnerName" VARCHAR(160),
  "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "clearedAt" TIMESTAMP(3),
  "announcedAt" TIMESTAMP(3),
  CONSTRAINT "survivor_tribe_immunities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "survivor_tribe_immunities_leagueId_week_tribeId_key" ON "survivor_tribe_immunities"("leagueId", "week", "tribeId");
CREATE INDEX IF NOT EXISTS "survivor_tribe_immunities_leagueId_clearedAt_idx" ON "survivor_tribe_immunities"("leagueId", "clearedAt");

CREATE TABLE IF NOT EXISTS "survivor_moments_seen" (
  "id" TEXT NOT NULL,
  "leagueId" VARCHAR(64) NOT NULL,
  "userId" VARCHAR(64) NOT NULL,
  "momentKey" VARCHAR(160) NOT NULL,
  "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "survivor_moments_seen_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "survivor_moments_seen_leagueId_userId_momentKey_key" ON "survivor_moments_seen"("leagueId", "userId", "momentKey");
