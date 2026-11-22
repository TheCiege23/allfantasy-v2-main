CREATE TABLE "zombie_correction_reviews" (
  "id" TEXT NOT NULL,
  "zombieLeagueId" TEXT NOT NULL,
  "fromWeek" INTEGER NOT NULL,
  "sourceHash" VARCHAR(64) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'ready',
  "source" JSONB NOT NULL,
  "plan" JSONB NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "approvedByUserId" TEXT,
  "reason" TEXT,
  "appliedAt" TIMESTAMP(3),
  "effectsPending" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "zombie_correction_reviews_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "zombie_correction_source_key" ON "zombie_correction_reviews"("zombieLeagueId", "fromWeek", "sourceHash");
CREATE INDEX "zombie_correction_reviews_effectsPending_updatedAt_idx" ON "zombie_correction_reviews"("effectsPending", "updatedAt");
ALTER TABLE "zombie_correction_reviews" ADD CONSTRAINT "zombie_correction_reviews_zombieLeagueId_fkey" FOREIGN KEY ("zombieLeagueId") REFERENCES "zombie_leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "zombie_leagues" ADD COLUMN "correctionHoldFromWeek" INTEGER;
ALTER TABLE "zombie_leagues" ADD COLUMN "latestCorrectionReviewId" TEXT;

-- REPORT_HOLD_FUNCTION
CREATE OR REPLACE FUNCTION zombie_weekly_report_correction_hold() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."type" = 'weekly_update' AND NEW."isPosted" = true
     AND (TG_OP = 'INSERT' OR OLD."isPosted" = false)
     AND EXISTS (SELECT 1 FROM zombie_leagues WHERE id = NEW."zombieLeagueId" AND "correctionHoldFromWeek" IS NOT NULL)
  THEN
    RAISE EXCEPTION 'ZOMBIE_CORRECTION_REPORT_HOLD';
  END IF;
  RETURN NEW;
END;
$$;
-- REPORT_HOLD_TRIGGER
CREATE TRIGGER zombie_weekly_report_correction_hold
BEFORE INSERT OR UPDATE ON zombie_announcements
FOR EACH ROW EXECUTE FUNCTION zombie_weekly_report_correction_hold();
