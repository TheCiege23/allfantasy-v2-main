-- Frozen per-participant proposal-time grades and reasons.
ALTER TABLE "trade_decision_snapshots"
  ADD COLUMN IF NOT EXISTS "decisionResult" JSONB;
