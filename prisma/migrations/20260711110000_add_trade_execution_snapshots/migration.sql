-- Independent additive trade evidence foundation. Does not depend on renewal tables.
CREATE TABLE "trade_execution_snapshots" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "tradeSource" VARCHAR(32) NOT NULL,
    "nativeTradeId" TEXT,
    "genericTradeId" TEXT,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT,
    "tenantId" TEXT NOT NULL DEFAULT 'allfantasy',
    "organizationId" TEXT,
    "executionIdempotencyKey" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL,
    "executedByActorId" TEXT NOT NULL,
    "executedByActorRole" VARCHAR(32) NOT NULL,
    "governance" JSONB NOT NULL,
    "validations" JSONB NOT NULL,
    "beforeState" JSONB NOT NULL,
    "afterState" JSONB NOT NULL,
    "assetSummary" JSONB NOT NULL,
    "dependencies" JSONB NOT NULL DEFAULT '{}',
    "completeness" VARCHAR(16) NOT NULL DEFAULT 'complete',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trade_execution_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "trade_execution_snapshots_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "trade_execution_snapshots_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "redraft_seasons"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "trade_execution_snapshots_nativeTradeId_fkey" FOREIGN KEY ("nativeTradeId") REFERENCES "redraft_trade_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "trade_execution_snapshots_genericTradeId_fkey" FOREIGN KEY ("genericTradeId") REFERENCES "af_league_trades"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "trade_execution_snapshots_tradeId_key" ON "trade_execution_snapshots"("tradeId");
CREATE UNIQUE INDEX "trade_execution_snapshots_nativeTradeId_key" ON "trade_execution_snapshots"("nativeTradeId");
CREATE UNIQUE INDEX "trade_execution_snapshots_genericTradeId_key" ON "trade_execution_snapshots"("genericTradeId");
CREATE UNIQUE INDEX "trade_execution_snapshots_executionIdempotencyKey_key" ON "trade_execution_snapshots"("executionIdempotencyKey");
CREATE UNIQUE INDEX "trade_execution_snapshots_eventId_key" ON "trade_execution_snapshots"("eventId");
CREATE INDEX "trade_execution_snapshots_leagueId_executedAt_idx" ON "trade_execution_snapshots"("leagueId", "executedAt");
CREATE INDEX "trade_execution_snapshots_seasonId_executedAt_idx" ON "trade_execution_snapshots"("seasonId", "executedAt");

CREATE TABLE "trade_reversals" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT,
    "actorId" TEXT NOT NULL,
    "actorRole" VARCHAR(32) NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "readiness" JSONB NOT NULL,
    "restoredState" JSONB NOT NULL,
    "eventId" TEXT NOT NULL,
    "noticeKey" TEXT NOT NULL,
    "reversedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trade_reversals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "trade_reversals_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "trade_execution_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "trade_reversals_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "trade_reversals_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "redraft_seasons"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "trade_reversals_tradeId_key" ON "trade_reversals"("tradeId");
CREATE UNIQUE INDEX "trade_reversals_snapshotId_key" ON "trade_reversals"("snapshotId");
CREATE UNIQUE INDEX "trade_reversals_idempotencyKey_key" ON "trade_reversals"("idempotencyKey");
CREATE UNIQUE INDEX "trade_reversals_eventId_key" ON "trade_reversals"("eventId");
CREATE UNIQUE INDEX "trade_reversals_noticeKey_key" ON "trade_reversals"("noticeKey");
CREATE INDEX "trade_reversals_leagueId_reversedAt_idx" ON "trade_reversals"("leagueId", "reversedAt");
