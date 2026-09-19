-- Safe to re-run. Creates the manager strategy store and immutable trade evidence ledger.
CREATE TABLE IF NOT EXISTS "trade_manager_strategies" (
  "id" TEXT NOT NULL,
  "leagueId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "rosterId" TEXT,
  "active" VARCHAR(24) NOT NULL DEFAULT 'balanced',
  "source" VARCHAR(32) NOT NULL DEFAULT 'manager_confirmed',
  "confirmedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trade_manager_strategies_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "trade_decision_snapshots" (
  "id" TEXT NOT NULL,
  "tradeId" TEXT NOT NULL,
  "leagueId" TEXT NOT NULL,
  "proposedByUserId" TEXT NOT NULL,
  "policyVersion" VARCHAR(48) NOT NULL,
  "format" VARCHAR(32) NOT NULL,
  "leagueContext" JSONB NOT NULL,
  "rosterContext" JSONB NOT NULL,
  "assetContext" JSONB NOT NULL,
  "managerContext" JSONB NOT NULL,
  "outcomeSimulation" JSONB,
  "evidence" JSONB NOT NULL,
  "readiness" JSONB NOT NULL,
  "completeness" VARCHAR(16) NOT NULL DEFAULT 'partial',
  "capturedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trade_decision_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "trade_manager_strategies_leagueId_userId_key" ON "trade_manager_strategies"("leagueId", "userId");
CREATE INDEX IF NOT EXISTS "trade_manager_strategies_leagueId_rosterId_idx" ON "trade_manager_strategies"("leagueId", "rosterId");
CREATE INDEX IF NOT EXISTS "trade_manager_strategies_userId_idx" ON "trade_manager_strategies"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "trade_decision_snapshots_tradeId_key" ON "trade_decision_snapshots"("tradeId");
CREATE INDEX IF NOT EXISTS "trade_decision_snapshots_leagueId_capturedAt_idx" ON "trade_decision_snapshots"("leagueId", "capturedAt");
CREATE INDEX IF NOT EXISTS "trade_decision_snapshots_proposedByUserId_capturedAt_idx" ON "trade_decision_snapshots"("proposedByUserId", "capturedAt");
