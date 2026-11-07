\set ON_ERROR_STOP on
CREATE TABLE playoff_bracket_challenges (id TEXT PRIMARY KEY, sport TEXT NOT NULL, is_test_mode BOOLEAN NOT NULL);
CREATE TABLE playoff_bracket_entries (id TEXT PRIMARY KEY, challenge_id TEXT NOT NULL, finalized_at TIMESTAMP(3));
CREATE TABLE playoff_bracket_picks (id TEXT PRIMARY KEY, challenge_id TEXT NOT NULL, entry_id TEXT NOT NULL, pick_team_name TEXT NOT NULL);
INSERT INTO playoff_bracket_challenges VALUES ('cup','nba_cup',false),('cup-test','nba_cup',true),('other','nfl',false);
INSERT INTO playoff_bracket_entries VALUES ('done','cup','2026-11-01 12:00'),('draft','cup',NULL),('test','cup-test','2026-11-01 12:00'),('nfl','other','2026-11-01 12:00');
INSERT INTO playoff_bracket_picks VALUES ('confirmed','cup','done','Boston Celtics'),('unconfirmed','cup','draft','Chicago Bulls'),('testing','cup-test','test','Boston Celtics'),('football','other','nfl','Chiefs');
\i prisma/migrations/20261108000000_cup_daily_pick_confirmation/migration.sql
DO $$
BEGIN
  IF (SELECT confirmed_at FROM playoff_bracket_picks WHERE id='confirmed') IS DISTINCT FROM TIMESTAMP '2026-11-01 12:00' THEN RAISE EXCEPTION 'existing confirmed pick was not preserved'; END IF;
  IF EXISTS(SELECT 1 FROM playoff_bracket_picks WHERE id IN ('unconfirmed','testing','football') AND confirmed_at IS NOT NULL) THEN RAISE EXCEPTION 'unrelated or draft pick was confirmed'; END IF;
  IF (SELECT count(*) FROM playoff_bracket_picks WHERE draft_team_name IS NULL) <> 4 THEN RAISE EXCEPTION 'unexpected drafts'; END IF;
  IF (SELECT pick_team_name FROM playoff_bracket_picks WHERE id='unconfirmed') <> 'Chicago Bulls' THEN RAISE EXCEPTION 'existing draft changed'; END IF;
END $$;
SELECT 'migration assertions passed' AS result;
