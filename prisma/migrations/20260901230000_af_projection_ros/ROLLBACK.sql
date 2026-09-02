-- Rollback for 20260901230000_af_projection_ros.
--
-- Safe to run at any point: both columns are additive and nullable, so dropping them cannot lose
-- data that existed before the migration. It DOES discard every rest-of-season value computed
-- since, which the writer will recompute on its next scheduled run.
--
-- ⚠ DROP THE CODE FIRST. If the deployed Prisma client still selects these columns, dropping them
-- raises P2022 on every read of AFProjectionSnapshot — which is most of the projection surface.
-- Roll the code back, confirm it is live, then run this.

ALTER TABLE "AFProjectionSnapshot"
  DROP COLUMN IF EXISTS "rosProjection",
  DROP COLUMN IF EXISTS "rosWeeksRemaining";
