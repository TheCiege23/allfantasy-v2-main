-- Migration: playoff_bracket_scoring_fields
-- Adds scoring fields to PlayoffBracketEntry and PlayoffBracketPick
-- Safe: all new columns have DEFAULT values, no nullability changes to existing data

-- PlayoffBracketEntry: scoring aggregate fields
ALTER TABLE "playoff_bracket_entries"
  ADD COLUMN IF NOT EXISTS "total_score"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "correct_picks" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "rank"          INTEGER,
  ADD COLUMN IF NOT EXISTS "submitted_at"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "is_locked"     BOOLEAN NOT NULL DEFAULT false;

-- PlayoffBracketPick: per-pick scoring fields
ALTER TABLE "playoff_bracket_picks"
  ADD COLUMN IF NOT EXISTS "points_awarded" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "is_correct"     BOOLEAN;

-- PlayoffBracketSeries: live series win counts
ALTER TABLE "playoff_bracket_series"
  ADD COLUMN IF NOT EXISTS "home_wins" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "away_wins" INTEGER NOT NULL DEFAULT 0;

-- Index: leaderboard sort (challengeId + totalScore DESC)
CREATE INDEX IF NOT EXISTS "playoff_bracket_entries_challenge_id_total_score_idx"
  ON "playoff_bracket_entries"("challenge_id", "total_score");
