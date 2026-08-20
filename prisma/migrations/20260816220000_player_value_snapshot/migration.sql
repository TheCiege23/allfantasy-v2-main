CREATE TABLE IF NOT EXISTS "PlayerValueSnapshot" (
    "id" TEXT NOT NULL,
    "sleeperId" VARCHAR(32) NOT NULL,
    "name" TEXT NOT NULL,
    "position" VARCHAR(8),
    "source" VARCHAR(24) NOT NULL,
    "format" VARCHAR(12) NOT NULL,
    "qbFormat" VARCHAR(12) NOT NULL,
    "value" INTEGER NOT NULL,
    "overallRank" INTEGER,
    "positionRank" INTEGER,
    "trend30d" INTEGER,
    "tradeFrequency" DOUBLE PRECISION,
    "marketStdDev" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlayerValueSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PlayerValueSnapshot_uniq" ON "PlayerValueSnapshot"("sleeperId","source","format","qbFormat","capturedAt");
CREATE INDEX IF NOT EXISTS "PlayerValueSnapshot_player_idx" ON "PlayerValueSnapshot"("sleeperId","capturedAt");
CREATE INDEX IF NOT EXISTS "PlayerValueSnapshot_source_idx" ON "PlayerValueSnapshot"("source","capturedAt");
