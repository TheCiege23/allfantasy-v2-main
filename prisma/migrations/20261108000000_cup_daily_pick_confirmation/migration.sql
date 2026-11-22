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

-- Old app instances can continue serving traffic while Railway rolls out the new
-- app. Preserve their established save/finalize semantics during that overlap.
-- New app transactions explicitly opt in to per-day semantics with SET LOCAL.
CREATE FUNCTION cup_legacy_pick_compat() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE submission TIMESTAMP(3);
BEGIN
  IF current_setting('allfantasy.cup_daily_mode', true) = 'on' THEN RETURN NEW; END IF;
  SELECT e.finalized_at INTO submission
    FROM playoff_bracket_entries e JOIN playoff_bracket_challenges c ON c.id = e.challenge_id
   WHERE e.id = NEW.entry_id AND c.id = NEW.challenge_id AND c.sport = 'nba_cup' AND c.is_test_mode = false;
  IF submission IS NOT NULL THEN
    NEW.confirmed_at := submission;
    NEW.draft_team_name := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cup_legacy_pick_compat BEFORE INSERT OR UPDATE OF pick_team_name ON playoff_bracket_picks
  FOR EACH ROW EXECUTE FUNCTION cup_legacy_pick_compat();

CREATE FUNCTION cup_legacy_entry_compat() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('allfantasy.cup_daily_mode', true) = 'on' THEN RETURN NEW; END IF;
  IF OLD.finalized_at IS NULL AND NEW.finalized_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM playoff_bracket_challenges c WHERE c.id = NEW.challenge_id AND c.sport = 'nba_cup' AND c.is_test_mode = false
  ) THEN
    UPDATE playoff_bracket_picks SET confirmed_at = NEW.finalized_at, draft_team_name = NULL
      WHERE entry_id = NEW.id AND challenge_id = NEW.challenge_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cup_legacy_entry_compat AFTER UPDATE OF finalized_at ON playoff_bracket_entries
  FOR EACH ROW EXECUTE FUNCTION cup_legacy_entry_compat();
