ALTER TABLE "zombie_leagues"
  ADD COLUMN "whispererCount" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "zombie_co_whisperers" (
  "id" TEXT NOT NULL,
  "zombieLeagueId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "selectionMode" TEXT NOT NULL,
  "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "isPubliclyRevealed" BOOLEAN NOT NULL DEFAULT true,
  "ambushesGranted" INTEGER NOT NULL DEFAULT 3,
  "ambushesUsed" INTEGER NOT NULL DEFAULT 0,
  "ambushesRemaining" INTEGER NOT NULL DEFAULT 3,
  "wasDefeated" BOOLEAN NOT NULL DEFAULT false,
  "defeatedAtWeek" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "zombie_co_whisperers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "zombie_co_whisperers_zombieLeagueId_userId_key"
  ON "zombie_co_whisperers"("zombieLeagueId", "userId");
CREATE INDEX "zombie_co_whisperers_zombieLeagueId_idx"
  ON "zombie_co_whisperers"("zombieLeagueId");

ALTER TABLE "zombie_co_whisperers"
  ADD CONSTRAINT "zombie_co_whisperers_zombieLeagueId_fkey"
  FOREIGN KEY ("zombieLeagueId") REFERENCES "zombie_leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
