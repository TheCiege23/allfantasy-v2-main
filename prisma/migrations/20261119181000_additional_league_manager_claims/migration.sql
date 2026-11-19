BEGIN;
ALTER TABLE "LeagueManagerClaim" ADD COLUMN "claimSlot" TEXT NOT NULL DEFAULT 'primary';
CREATE UNIQUE INDEX "LeagueManagerClaim_leagueId_afUserId_claimSlot_key" ON "LeagueManagerClaim"("leagueId", "afUserId", "claimSlot");
DROP INDEX "LeagueManagerClaim_leagueId_afUserId_key";
COMMIT;
