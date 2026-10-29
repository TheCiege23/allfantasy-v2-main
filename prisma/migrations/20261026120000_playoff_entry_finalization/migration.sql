ALTER TABLE "playoff_bracket_entries"
  ADD COLUMN "finalized_at" TIMESTAMP(3),
  ADD COLUMN "tiebreaker_total_score" INTEGER;

CREATE INDEX "playoff_bracket_entries_challenge_id_finalized_at_idx"
  ON "playoff_bracket_entries"("challenge_id", "finalized_at");
