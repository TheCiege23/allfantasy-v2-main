-- Week-by-week redraft rosters: one row per roster per week, holding who was on the team as that
-- week was scored, frozen once its matchup is final. Additive: one new empty table, its indexes and
-- its FK to redraft_rosters. No change to any existing table. lib/redraft/rosterWeekHistory.ts
-- tolerates this table being absent (scoring falls back to the current roster, exactly as before),
-- so the code may land before this is applied.

-- CreateTable
CREATE TABLE "redraft_roster_weeks" (
    "id" TEXT NOT NULL,
    "rosterId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "players" JSONB NOT NULL,
    "frozen" BOOLEAN NOT NULL DEFAULT false,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "redraft_roster_weeks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "redraft_roster_weeks_rosterId_week_key" ON "redraft_roster_weeks"("rosterId", "week");

-- CreateIndex
CREATE INDEX "redraft_roster_weeks_seasonId_week_idx" ON "redraft_roster_weeks"("seasonId", "week");

-- AddForeignKey
ALTER TABLE "redraft_roster_weeks" ADD CONSTRAINT "redraft_roster_weeks_rosterId_fkey" FOREIGN KEY ("rosterId") REFERENCES "redraft_rosters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
