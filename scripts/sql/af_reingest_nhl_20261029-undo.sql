-- UNDO for the admin "Re-ingest Stats & Rescore Weeks" Apply on 2026-10-29:
--   NHL league d41382f9-6700-475d-ac8c-041632dd0a33 ("NHL Season Verification"),
--   redraft season cmufll2hk00hf4iy1d7b21feu (2026), weeks 1-2.
--
-- Pre-image tables were created on production BEFORE Apply (2026-10-29):
--   af_reingest_nhl_20261029_matchups               38 rows  (every matchup of the season)
--   af_reingest_nhl_20261029_rosters                 4 rows  (redraft_rosters standings)
--   af_reingest_nhl_20261029_league_teams            4 rows  (league_teams standings copy)
--   af_reingest_nhl_20261029_players                94 rows  (every playerId ever on these rosters)
--   af_reingest_nhl_20261029_player_weekly_scores  142 rows  (NHL 2026 weeks 1-2, those players)
--   af_reingest_nhl_20261029_player_daily_scores     0 rows  (none existed; Apply creates them)
--   af_reingest_nhl_20261029_lpws                    0 rows  (league_player_weekly_scores; none existed)
--
-- What this restores: matchup scores/status/snapshots, standings columns on redraft_rosters and
-- league_teams, and the per-player weekly/daily/league score rows in the same scope. It does NOT
-- touch player_game_stats: the re-ingest itself is a correct upsert of provider data and is not
-- undone. It leaves FAAB, waiver priority and every other non-scoring column alone.
--
-- player_weekly_scores and player_daily_scores are keyed per player, not per league, so restoring
-- them also restores what any other league reading those NHL players saw for weeks 1-2.
--
-- Review first. Run inside one transaction. Not run by any script.

BEGIN;

UPDATE redraft_matchups m SET
  "homeScore" = p."homeScore",
  "awayScore" = p."awayScore",
  "status" = p."status",
  "medianScore" = p."medianScore",
  "lineupSnapshots" = p."lineupSnapshots"
FROM af_reingest_nhl_20261029_matchups p
WHERE m.id = p.id;

UPDATE redraft_rosters r SET
  "wins" = p."wins",
  "losses" = p."losses",
  "ties" = p."ties",
  "pointsFor" = p."pointsFor",
  "pointsAgainst" = p."pointsAgainst",
  "streak" = p."streak",
  "playoffSeed" = p."playoffSeed"
FROM af_reingest_nhl_20261029_rosters p
WHERE r.id = p.id;

UPDATE league_teams t SET
  "wins" = p."wins",
  "losses" = p."losses",
  "ties" = p."ties",
  "pointsFor" = p."pointsFor",
  "pointsAgainst" = p."pointsAgainst",
  "currentRank" = p."currentRank"
FROM af_reingest_nhl_20261029_league_teams p
WHERE t.id = p.id;

DELETE FROM player_weekly_scores w
WHERE w.sport = 'NHL' AND w.season = 2026 AND w.week IN (1, 2)
  AND w."playerId" IN (SELECT "playerId" FROM af_reingest_nhl_20261029_players);
INSERT INTO player_weekly_scores SELECT * FROM af_reingest_nhl_20261029_player_weekly_scores;

DELETE FROM player_daily_scores d
WHERE d.sport = 'NHL' AND d.season = 2026
  AND (d.week IN (1, 2) OR d."scoringDay" BETWEEN '2026-09-25' AND '2026-10-15')
  AND d."playerId" IN (SELECT "playerId" FROM af_reingest_nhl_20261029_players);
INSERT INTO player_daily_scores SELECT * FROM af_reingest_nhl_20261029_player_daily_scores;

DELETE FROM league_player_weekly_scores
WHERE "leagueId" = 'd41382f9-6700-475d-ac8c-041632dd0a33' AND "seasonYear" = 2026 AND week IN (1, 2);
INSERT INTO league_player_weekly_scores SELECT * FROM af_reingest_nhl_20261029_lpws;

-- Verify before COMMIT: week 1 matchup cmufll6bp00lp4iy1pdv1mjoz must read 7.8 vs 17.4 again.
SELECT id, week, "homeScore", "awayScore", status FROM redraft_matchups
WHERE "seasonId" = 'cmufll2hk00hf4iy1d7b21feu' AND week IN (1, 2) ORDER BY week, id;

COMMIT;

-- Afterwards, once nobody needs the undo:
-- DROP TABLE af_reingest_nhl_20261029_matchups, af_reingest_nhl_20261029_rosters,
--   af_reingest_nhl_20261029_league_teams, af_reingest_nhl_20261029_players,
--   af_reingest_nhl_20261029_player_weekly_scores, af_reingest_nhl_20261029_player_daily_scores,
--   af_reingest_nhl_20261029_lpws;
