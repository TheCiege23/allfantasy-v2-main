-- Nightly trade agent suggestions (design build step 9, 2026-09-27). A new, empty table: nothing
-- existing is altered. The code ships before this is applied and does nothing until it is — every
-- reader and writer asks `tradeAgentTableReady()` first.
CREATE TABLE IF NOT EXISTS "trade_agent_suggestions" (
    "id" TEXT NOT NULL,
    "leagueId" VARCHAR(64) NOT NULL,
    "userId" VARCHAR(64) NOT NULL,
    "rosterId" VARCHAR(128) NOT NULL,
    "partnerRosterId" VARCHAR(128) NOT NULL,
    "partnerName" VARCHAR(128),
    "give" JSONB NOT NULL,
    "get" JSONB NOT NULL,
    "dealKey" VARCHAR(512) NOT NULL,
    "letter" VARCHAR(2) NOT NULL,
    "partnerLetter" VARCHAR(2) NOT NULL,
    "percentDiff" INTEGER NOT NULL,
    "giveValue" INTEGER NOT NULL,
    "getValue" INTEGER NOT NULL,
    "viewerFitPct" INTEGER NOT NULL,
    "partnerFitPct" INTEGER NOT NULL,
    "basis" TEXT NOT NULL,
    "runDate" VARCHAR(10) NOT NULL,
    "rank" INTEGER NOT NULL,
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_agent_suggestions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "trade_agent_suggestions_leagueId_userId_runDate_dealKey_key" ON "trade_agent_suggestions"("leagueId", "userId", "runDate", "dealKey");
CREATE INDEX IF NOT EXISTS "trade_agent_suggestions_userId_leagueId_runDate_idx" ON "trade_agent_suggestions"("userId", "leagueId", "runDate");
