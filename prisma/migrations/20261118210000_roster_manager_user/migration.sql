-- A manager may run several teams in one league (lib/league/multiTeamManagers.ts). Each roster keeps
-- its unique (leagueId, platformUserId) key, which the provider sync relies on; a manager's second and
-- later teams keep a key of their own and name the manager in this column instead.
-- Additive: two nullable columns and two indexes. No existing row changes, and code that does not
-- know the columns keeps working, so this can be applied before the code that reads it is deployed.

-- AlterTable
ALTER TABLE "rosters" ADD COLUMN "managerUserId" TEXT;

-- AlterTable
ALTER TABLE "redraft_rosters" ADD COLUMN "managerUserId" TEXT;

-- CreateIndex
CREATE INDEX "idx_rosters_league_manager" ON "rosters"("leagueId", "managerUserId");

-- CreateIndex
CREATE INDEX "idx_redraft_rosters_season_manager" ON "redraft_rosters"("seasonId", "managerUserId");
