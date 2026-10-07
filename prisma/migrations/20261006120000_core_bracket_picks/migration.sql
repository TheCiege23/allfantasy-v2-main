-- /core Bracket Challenge picks: one row per account per sport per season (champion + final series
-- length). Additive: one new empty table, its unique index and its FK to app_users. No change to any
-- existing table. /api/core/bracket-picks tolerates this table being absent (P2021 -> "saving
-- unavailable", and the screen keeps its preview behaviour), so the code may land before this is
-- applied.

-- CreateTable
CREATE TABLE "core_bracket_picks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sport" VARCHAR(16) NOT NULL,
    "seasonYear" INTEGER NOT NULL,
    "championTeamId" TEXT,
    "finalLength" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_bracket_picks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "core_bracket_picks_userId_sport_seasonYear_key" ON "core_bracket_picks"("userId", "sport", "seasonYear");

-- AddForeignKey
ALTER TABLE "core_bracket_picks" ADD CONSTRAINT "core_bracket_picks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
