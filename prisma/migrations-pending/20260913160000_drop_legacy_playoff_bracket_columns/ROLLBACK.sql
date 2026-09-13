-- Rollback for 20260913160000_drop_legacy_playoff_bracket_columns.
--
-- Recreates the nine columns with the type, nullability and default production had on 2026-09-13,
-- restores the only two non-default values that existed, and recreates the index. Every value the
-- migration removed was the column default except those two, so this is a full restore, not a
-- partial one. (Column ORDER is not restored: re-added columns go to the end of the table. Nothing
-- reads by position.)
--
-- Safe to run whether or not the migration was applied: every statement is IF NOT EXISTS, and the
-- two updates only fill a NULL.
--
-- The timestamps are the ::text form of `timestamp(3) without time zone` on a GMT server. Do not
-- replace them with values read through a JS Date, which shifts them by the reader's local offset.

ALTER TABLE "playoff_bracket_entries"
  ADD COLUMN IF NOT EXISTS "total_score"   INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "correct_picks" INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "rank"          INTEGER,
  ADD COLUMN IF NOT EXISTS "submitted_at"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "is_locked"     BOOLEAN      NOT NULL DEFAULT false;

ALTER TABLE "playoff_bracket_picks"
  ADD COLUMN IF NOT EXISTS "points_awarded" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "is_correct"     BOOLEAN;

ALTER TABLE "playoff_bracket_series"
  ADD COLUMN IF NOT EXISTS "home_wins" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "away_wins" INTEGER NOT NULL DEFAULT 0;

UPDATE "playoff_bracket_entries" SET "submitted_at" = '2026-05-14 00:04:54.027'
  WHERE "id" = 'cmp4ps6bu000123c97q9s92cr' AND "submitted_at" IS NULL;
UPDATE "playoff_bracket_entries" SET "submitted_at" = '2026-05-14 00:08:47.82'
  WHERE "id" = 'cmp4qav8f0001t53xto3e25pl' AND "submitted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "playoff_bracket_entries_challenge_id_total_score_idx"
  ON "playoff_bracket_entries" ("challenge_id", "total_score");
