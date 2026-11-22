ALTER TABLE "pirate_claims"
  ADD COLUMN "selectionDeadlineAt" TIMESTAMP(3),
  ADD COLUMN "settledReturnPlayerId" TEXT,
  ADD COLUMN "overflowGraceUntil" TIMESTAMP(3),
  ADD COLUMN "reversedAt" TIMESTAMP(3),
  ADD COLUMN "reversedByUserId" TEXT,
  ADD COLUMN "reversalReason" TEXT;

ALTER TABLE "pirate_claims" DROP CONSTRAINT IF EXISTS "pirate_claims_matchupId_key";
DROP INDEX IF EXISTS "pirate_claims_matchupId_key";
CREATE UNIQUE INDEX "pirate_claims_matchupId_winnerRosterId_key"
  ON "pirate_claims"("matchupId", "winnerRosterId");
CREATE INDEX "pirate_claims_status_selectionDeadlineAt_idx"
  ON "pirate_claims"("status", "selectionDeadlineAt");

UPDATE "pirate_claims"
SET "selectionDeadlineAt" = "createdAt" + INTERVAL '24 hours'
WHERE "status" = 'awaiting_selection' AND "selectionDeadlineAt" IS NULL;
