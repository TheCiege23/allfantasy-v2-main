-- Trade value audits: every completed trade's value as priced when it happened, one row per trade.
-- Written by lib/integrity/tradeValueAudit.ts when the post-trade integrity scan runs, and by
-- scripts/backfill-trade-value-audits.ts for trades that settled before this existed. Read by the
-- commissioner's trade history review, the repeat-partner check and the collusion review.
-- Code ships ahead of this migration and skips every read and write while the table is absent.
-- Additive; no existing table is touched.

-- CreateTable
CREATE TABLE "trade_value_audits" (
    "id" TEXT NOT NULL,
    "league_id" TEXT NOT NULL,
    "trade_key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "side_a_team_id" TEXT NOT NULL,
    "side_b_team_id" TEXT NOT NULL,
    "side_a_name" TEXT NOT NULL,
    "side_b_name" TEXT NOT NULL,
    "side_a_gave" JSONB NOT NULL,
    "side_b_gave" JSONB NOT NULL,
    "side_a_value" DOUBLE PRECISION NOT NULL,
    "side_b_value" DOUBLE PRECISION NOT NULL,
    "gap_pct" DOUBLE PRECISION NOT NULL,
    "basis" TEXT NOT NULL,
    "completed_at" TIMESTAMP(3),
    "priced_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_value_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trade_value_audits_league_id_trade_key_key" ON "trade_value_audits"("league_id", "trade_key");

-- CreateIndex
CREATE INDEX "trade_value_audits_league_id_completed_at_idx" ON "trade_value_audits"("league_id", "completed_at");
