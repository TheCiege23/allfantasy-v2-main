CREATE TABLE IF NOT EXISTS "generic_trade_comparisons" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "generic_trade_comparisons_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "generic_trade_comparisons_userId_sourceId_key"
  ON "generic_trade_comparisons"("userId", "sourceId");
CREATE INDEX IF NOT EXISTS "generic_trade_comparisons_userId_createdAt_idx"
  ON "generic_trade_comparisons"("userId", "createdAt" DESC);
