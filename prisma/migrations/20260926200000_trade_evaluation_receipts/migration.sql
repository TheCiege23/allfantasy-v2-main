-- Append-only receipts for every trade evaluation (lib/decision-os/trade/evaluateTrade.ts).
-- Idempotent and free of foreign keys, like trade_decision_snapshots.
CREATE TABLE IF NOT EXISTS "trade_evaluation_receipts" (
  "id" TEXT NOT NULL,
  "surface" VARCHAR(48) NOT NULL,
  "modelVersion" VARCHAR(48) NOT NULL,
  "leagueId" TEXT,
  "userId" TEXT,
  "graded" BOOLEAN NOT NULL,
  "letter" VARCHAR(2),
  "percentDiff" INTEGER,
  "withheldReason" TEXT,
  "inputHash" VARCHAR(64) NOT NULL,
  "receipt" JSONB NOT NULL,
  "evaluatedAt" TIMESTAMPTZ(6) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trade_evaluation_receipts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "trade_evaluation_receipts_leagueId_evaluatedAt_idx" ON "trade_evaluation_receipts"("leagueId", "evaluatedAt");
CREATE INDEX IF NOT EXISTS "trade_evaluation_receipts_userId_evaluatedAt_idx" ON "trade_evaluation_receipts"("userId", "evaluatedAt");
CREATE INDEX IF NOT EXISTS "trade_evaluation_receipts_inputHash_idx" ON "trade_evaluation_receipts"("inputHash");
