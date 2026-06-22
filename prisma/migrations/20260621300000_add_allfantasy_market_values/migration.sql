-- T9: official AllFantasy market value layer (allfantasy_market_player_values, _value_audits).
--
-- SAFETY:
--  * Purely ADDITIVE — two new tables + indexes only. No existing table changes; no FK. Provider /
--    projection / ADP / snapshot data is never touched. Existing production data is untouched.
--  * IDEMPOTENT — IF NOT EXISTS everywhere; safe to re-run.
--  * Live Neon has drifted from schema.prisma in unrelated ways, so a full `prisma migrate dev` /
--    `db push` would emit destructive DROPs. Hand-authored + applied via `prisma db execute`, then
--    recorded with `prisma migrate resolve --applied`.

CREATE TABLE IF NOT EXISTS "allfantasy_market_player_values" (
  "id" TEXT NOT NULL,
  "sport" TEXT NOT NULL,
  "leagueConcept" TEXT NOT NULL,
  "scoringFormat" TEXT,
  "playerId" TEXT NOT NULL,
  "playerName" TEXT,
  "position" TEXT,
  "team" TEXT,
  "baseValue" INTEGER NOT NULL,
  "marketValue" INTEGER NOT NULL,
  "adjustmentPercent" DOUBLE PRECISION NOT NULL,
  "adjustmentPoints" INTEGER NOT NULL,
  "confidence" INTEGER NOT NULL,
  "sampleSize" INTEGER NOT NULL,
  "acceptedTradeCount" INTEGER NOT NULL DEFAULT 0,
  "rejectedSignalCount" INTEGER NOT NULL DEFAULT 0,
  "vetoedSignalCount" INTEGER NOT NULL DEFAULT 0,
  "blockSignalCount" INTEGER NOT NULL DEFAULT 0,
  "interestSignalCount" INTEGER NOT NULL DEFAULT 0,
  "recentSignalCount" INTEGER NOT NULL DEFAULT 0,
  "direction" TEXT NOT NULL,
  "published" BOOLEAN NOT NULL DEFAULT false,
  "sourceVersion" TEXT NOT NULL,
  "calculationVersion" TEXT NOT NULL,
  "reasons" JSONB NOT NULL DEFAULT '[]',
  "generatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "allfantasy_market_player_values_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "allfantasy_market_player_values_sport_concept_player_key"
  ON "allfantasy_market_player_values" ("sport", "leagueConcept", "playerId");
CREATE INDEX IF NOT EXISTS "allfantasy_market_player_values_sport_concept_pos_idx" ON "allfantasy_market_player_values" ("sport", "leagueConcept", "position");
CREATE INDEX IF NOT EXISTS "allfantasy_market_player_values_generatedAt_idx" ON "allfantasy_market_player_values" ("generatedAt");
CREATE INDEX IF NOT EXISTS "allfantasy_market_player_values_confidence_idx" ON "allfantasy_market_player_values" ("confidence");
CREATE INDEX IF NOT EXISTS "allfantasy_market_player_values_sampleSize_idx" ON "allfantasy_market_player_values" ("sampleSize");

CREATE TABLE IF NOT EXISTS "allfantasy_market_value_audits" (
  "id" TEXT NOT NULL,
  "marketValueId" TEXT,
  "sport" TEXT NOT NULL,
  "leagueConcept" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "previousValue" INTEGER,
  "newValue" INTEGER NOT NULL,
  "previousAdjustmentPercent" DOUBLE PRECISION,
  "newAdjustmentPercent" DOUBLE PRECISION NOT NULL,
  "confidence" INTEGER NOT NULL,
  "sampleSize" INTEGER NOT NULL,
  "reasonSummary" JSONB NOT NULL DEFAULT '[]',
  "calculationVersion" TEXT NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "allfantasy_market_value_audits_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "allfantasy_market_value_audits_sport_concept_player_idx" ON "allfantasy_market_value_audits" ("sport", "leagueConcept", "playerId");
CREATE INDEX IF NOT EXISTS "allfantasy_market_value_audits_generatedAt_idx" ON "allfantasy_market_value_audits" ("generatedAt");
