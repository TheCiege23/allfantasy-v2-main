ALTER TABLE "pirate_claims" ALTER COLUMN "matchupId" DROP NOT NULL;
ALTER TABLE "pirate_claims" ADD COLUMN "playoffMatchupId" TEXT;
ALTER TABLE "pirate_claims" ADD CONSTRAINT "pirate_claims_playoff_matchup_check" CHECK (("matchupId" IS NOT NULL) <> ("playoffMatchupId" IS NOT NULL));
CREATE UNIQUE INDEX "pirate_claims_playoffMatchupId_winnerRosterId_claimCycle_key" ON "pirate_claims"("playoffMatchupId", "winnerRosterId", "claimCycle");
ALTER TABLE "pirate_claims" ADD CONSTRAINT "pirate_claims_playoffMatchupId_fkey" FOREIGN KEY ("playoffMatchupId") REFERENCES "redraft_playoff_matchups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
