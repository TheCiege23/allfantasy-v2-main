-- A league whose teams play several games a week (Fantrax: 3 or 5) needs one row per game.
-- Additive: every existing row is game 1, so the new key holds wherever the old one did.

-- DropIndex
DROP INDEX "WeeklyMatchup_leagueId_seasonYear_week_rosterId_key";

-- AlterTable
ALTER TABLE "WeeklyMatchup" ADD COLUMN     "game" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyMatchup_leagueId_seasonYear_week_rosterId_game_key" ON "WeeklyMatchup"("leagueId", "seasonYear", "week", "rosterId", "game");
