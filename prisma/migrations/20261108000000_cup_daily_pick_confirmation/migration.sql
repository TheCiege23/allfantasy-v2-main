-- Preserve every existing pick and its previous submission eligibility.
ALTER TABLE "playoff_bracket_picks"
  ADD COLUMN "confirmed_at" TIMESTAMP(3),
  ADD COLUMN "draft_team_name" TEXT;

UPDATE "playoff_bracket_picks" AS p
SET "confirmed_at" = e."finalized_at"
FROM "playoff_bracket_entries" AS e
JOIN "playoff_bracket_challenges" AS c ON c."id" = e."challenge_id"
WHERE p."entry_id" = e."id"
  AND p."challenge_id" = c."id"
  AND c."sport" = 'nba_cup'
  AND c."is_test_mode" = false
  AND e."finalized_at" IS NOT NULL;
