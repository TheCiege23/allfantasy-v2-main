-- One receipt table (2026-09-26): trade_decision_snapshots also holds evaluateTrade() receipts.
-- Proposal rows keep their tradeId; an ad-hoc evaluation (no trade) stores tradeId/leagueId/
-- proposedByUserId as NULL. Every existing reader selects by tradeId, so those rows are invisible
-- to trade screens. Additive and idempotent; no data is rewritten.
ALTER TABLE "trade_decision_snapshots" ALTER COLUMN "tradeId" DROP NOT NULL;
ALTER TABLE "trade_decision_snapshots" ALTER COLUMN "leagueId" DROP NOT NULL;
ALTER TABLE "trade_decision_snapshots" ALTER COLUMN "proposedByUserId" DROP NOT NULL;
ALTER TABLE "trade_decision_snapshots" ADD COLUMN IF NOT EXISTS "surface" VARCHAR(48);
ALTER TABLE "trade_decision_snapshots" ADD COLUMN IF NOT EXISTS "inputHash" VARCHAR(64);
ALTER TABLE "trade_decision_snapshots" ADD COLUMN IF NOT EXISTS "evaluationReceipt" JSONB;

CREATE INDEX IF NOT EXISTS "trade_decision_snapshots_inputHash_idx" ON "trade_decision_snapshots"("inputHash");
CREATE INDEX IF NOT EXISTS "trade_decision_snapshots_surface_capturedAt_idx" ON "trade_decision_snapshots"("surface", "capturedAt");
