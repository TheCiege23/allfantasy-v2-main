-- Additive metadata only. Historic rows retain NULL: their market axes/time were not recorded.
-- Existing daily uniqueness remains unchanged; the ingest still captures four fixed 12-team PPR boards.
ALTER TABLE "PlayerValueSnapshot" ADD COLUMN IF NOT EXISTS "marketNumTeams" INTEGER;
ALTER TABLE "PlayerValueSnapshot" ADD COLUMN IF NOT EXISTS "marketPpr" DOUBLE PRECISION;
ALTER TABLE "PlayerValueSnapshot" ADD COLUMN IF NOT EXISTS "observedAt" TIMESTAMPTZ(3);
-- Rollback: deploy the previous reader/writer and retain these nullable columns and their evidence.
