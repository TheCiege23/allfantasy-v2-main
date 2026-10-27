ALTER TABLE "pirate_claims" ADD COLUMN "claimCycle" INTEGER NOT NULL DEFAULT 0;
DROP INDEX IF EXISTS "pirate_claims_matchupId_winnerRosterId_key";
CREATE UNIQUE INDEX "pirate_claims_matchupId_winnerRosterId_claimCycle_key"
  ON "pirate_claims"("matchupId", "winnerRosterId", "claimCycle");
