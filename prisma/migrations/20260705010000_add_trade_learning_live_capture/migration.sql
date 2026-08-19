-- Trade Learning Phase 8: live capture architecture, per
-- docs/TRADE_LEARNING_CAPTURE_ARCHITECTURE_ADR.md.
--
-- SAFETY:
--  * Purely ADDITIVE — one new enum value + two new nullable, uniquely
--    constrained columns. No existing table, column, or enum value changed
--    or removed.
--  * `afLeagueTradeId` on both TradeOfferEvent and TradeOutcomeEvent is the
--    idempotency key for live-captured events (AfLeagueTrade.id), distinct
--    from the existing `inputHash` (content-hash dedup for hypothetical
--    evaluations — unsafe to reuse for real trades, see the ADR §1.3) and
--    the existing `leagueTradeId` (legacy LeagueTrade.id, a different ID
--    space — see the ADR's schema-change rationale).
--  * `TradeOfferMode.LIVE_PROPOSAL` distinguishes real captured predictions
--    from the five existing hypothetical-evaluation-tool modes.
--  * Business behavior does not depend on this migration having run — the
--    application code that writes these new columns fails safely (try/catch,
--    never blocks the real trade action) if the write fails for any reason.

ALTER TYPE "TradeOfferMode" ADD VALUE IF NOT EXISTS 'LIVE_PROPOSAL';

ALTER TABLE "TradeOfferEvent" ADD COLUMN "afLeagueTradeId" TEXT;
CREATE UNIQUE INDEX "TradeOfferEvent_afLeagueTradeId_key" ON "TradeOfferEvent"("afLeagueTradeId");

ALTER TABLE "TradeOutcomeEvent" ADD COLUMN "afLeagueTradeId" TEXT;
CREATE UNIQUE INDEX "TradeOutcomeEvent_afLeagueTradeId_key" ON "TradeOutcomeEvent"("afLeagueTradeId");
