-- Decision OS Replay Framework, per
-- docs/SLEEPER_TRADE_REPLAY_ARCHITECTURE_ADR.md.
--
-- SAFETY:
--  * Purely ADDITIVE — two brand-new tables, no existing table, column, or
--    enum value changed, removed, or referenced.
--  * Neither table has any relation to TradeOfferEvent/TradeOutcomeEvent/
--    TradeLearningStats — no shared foreign key, no shared unique
--    constraint, no shared enum value. computeShadowB0()/promoteShadowB0()/
--    runWeeklyRecalibration() never read these tables; nothing in the
--    application writes to them from logTradeOfferEvent()/
--    logTradeOutcomeEvent() or captureLiveTradeOffer()/
--    captureLiveTradeOutcome().
--  * Generic and provider/decision-type-agnostic by design: "provider" and
--    "decisionType" are plain string columns, not enums, so future replay
--    types (waiver, draft, lineup, commissioner_action, roster_move) and
--    future providers need no schema migration to add — only new
--    application-level normalizers/backtest executors.
--  * ReplayBacktestResult is keyed per (replay, modelVersion,
--    engineVersionHash, deterministicConfigVersion) so re-running a
--    backtest after a future engine change produces a new row rather than
--    overwriting history — this is what makes cross-version offline
--    evaluation possible.

CREATE TABLE "replay_imports" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "decisionType" TEXT NOT NULL,
    "providerLeagueId" TEXT NOT NULL,
    "providerTransactionId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "providerWeek" INTEGER,
    "proposedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "providerStatus" TEXT NOT NULL,
    "participantsInvolved" JSONB NOT NULL,
    "managerUserIds" JSONB NOT NULL,
    "managerDisplayNames" JSONB NOT NULL,
    "payload" JSONB NOT NULL,
    "rawProviderPayload" JSONB NOT NULL,
    "contextSnapshot" JSONB NOT NULL,
    "isDynasty" BOOLEAN,
    "isSuperFlex" BOOLEAN,
    "ingestSourceUserId" TEXT NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "replay_imports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "replay_imports_provider_decisionType_providerLeagueId_pro_key"
    ON "replay_imports"("provider", "decisionType", "providerLeagueId", "providerTransactionId");

CREATE INDEX "replay_imports_decisionType_season_idx" ON "replay_imports"("decisionType", "season");
CREATE INDEX "replay_imports_provider_providerLeagueId_idx" ON "replay_imports"("provider", "providerLeagueId");

CREATE TABLE "replay_backtest_results" (
    "id" TEXT NOT NULL,
    "replayId" TEXT NOT NULL,
    "decisionType" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "engineVersionHash" TEXT NOT NULL,
    "deterministicConfigVersion" TEXT NOT NULL,
    "backtestedOutput" JSONB NOT NULL,
    "realOutcome" JSONB,
    "replayComputedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "replay_backtest_results_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "replay_backtest_results_replayId_modelVersion_engineVersi_key"
    ON "replay_backtest_results"("replayId", "modelVersion", "engineVersionHash", "deterministicConfigVersion");

CREATE INDEX "replay_backtest_results_decisionType_idx" ON "replay_backtest_results"("decisionType");

ALTER TABLE "replay_backtest_results" ADD CONSTRAINT "replay_backtest_results_replayId_fkey"
    FOREIGN KEY ("replayId") REFERENCES "replay_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
