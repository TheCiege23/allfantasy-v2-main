-- Rollback for 20260915010000_matchup_odds_snapshots.
--
-- ⚠ DESTRUCTIVE AND NOT REBUILDABLE: drops every saved pre-game win probability. These cannot be
-- recomputed afterwards (a scored week changes the model's inputs), so any upset moment for a week
-- captured here is lost for good. Nothing else references the table. Before running, record the row
-- count (select count(*) from "matchup_odds_snapshots") so the loss is a known number.

DROP INDEX IF EXISTS "matchup_odds_snapshots_season_week_idx";
DROP INDEX IF EXISTS "matchup_odds_snapshots_league_season_week_roster_key";
DROP TABLE IF EXISTS "matchup_odds_snapshots";
