-- af_trade_deadline_default_20261027
--
-- REVIEW FIRST. NOT RUN BY THE AUTHOR. Read-only part (a) was run against production on 2026-10-27;
-- parts (b)-(d) write and are for the owner to run, in one go, after reviewing (a)'s output.
--
-- What it does: gives every existing NATIVE REDRAFT league that has no trade deadline the default a new
-- league is created with (lib/trade-deadline/tradeDeadlineDefaults.ts, written at creation by
-- lib/league-creation/canonical/createCanonicalLeagueInTransaction.ts):
--
--     deadline week = playoff start week - 3        (NULL when that is below week 1)
--     NFL playoffs 15 -> 12, NFL 8-team 16 -> 13, NBA 23 -> 20, MLB 24 -> 21, NHL 25 -> 22
--
-- Where the deadline lives: the column leagues."tradeDeadlineWeek". The AF trade engine
-- (lib/league-trade-engine/tradeSettingsResolver.ts) prefers settings.commissionerSettings.tradeDeadlineWeek
-- when it is a number, so a league with that key set has a deadline already and is left alone.
--
-- The playoff start used: the league's newest redraft_seasons row when it has one (the season the
-- engine actually plays), else leagues."playoffStartWeek" (what creation sized the bracket to).
--
-- "Native redraft", mirroring which leagues creation gives a default to:
--   * native platform (lib/league/isNativeLeague.ts: allfantasy, af, manual, native, '' or NULL);
--   * leagues."leagueType" = 'redraft' (NULL reads as redraft, the schema default);
--   * settings.league_type 'redraft' or absent — a tournament feeder ('tournament') is excluded;
--   * leagueVariant NULL, 'redraft' or 'idp' — survivor_exile / zombie / other variants excluded;
--   * not roto (settings.scoring_mode), not best ball;
--   * sport NFL, NBA, NHL or MLB (the sports creation fits a bracket for; others get no default);
--   * lifecycleState not 'archived';
--   * not jp's 14-Team NFL Redraft League (owner: commissioner's choice, leave alone);
--   * and, so no league's trades close the moment this lands, the active season's current week is not
--     already past the new deadline.
-- Keeper leagues also get the default at creation; this backfill is deliberately redraft-only.
--
-- Undo: scripts/sql/af_trade_deadline_default_20261027-undo.sql (reads the pre-image table below).

-- ─── (a) PREVIEW — read-only. Run this alone first. ──────────────────────────────────────────────────
WITH candidates AS (
  SELECT
    l.id,
    l.name,
    l.sport::text                                           AS sport,
    l."lifecycleState"::text                                AS lifecycle_state,
    l."tradeDeadlineWeek"                                   AS current_value,
    COALESCE(rs."playoffStartWeek", l."playoffStartWeek")   AS playoff_start_week,
    COALESCE(rs."playoffStartWeek", l."playoffStartWeek") - 3 AS new_value,
    rs."currentWeek"                                        AS season_current_week
  FROM leagues l
  LEFT JOIN LATERAL (
    SELECT r."playoffStartWeek", r."currentWeek", r.status
    FROM redraft_seasons r
    WHERE r."leagueId" = l.id
    ORDER BY r."createdAt" DESC
    LIMIT 1
  ) rs ON true
  WHERE lower(COALESCE(l.platform, '')) IN ('allfantasy', 'af', 'manual', 'native', '')
    AND lower(COALESCE(l."leagueType", 'redraft')) = 'redraft'
    AND lower(COALESCE(l.settings->>'league_type', 'redraft')) = 'redraft'
    AND (l."leagueVariant" IS NULL OR lower(l."leagueVariant") IN ('redraft', 'idp'))
    AND lower(COALESCE(l.settings->>'scoring_mode', 'points')) <> 'roto'
    AND COALESCE(l."bestBallMode", false) = false
    AND l.sport::text IN ('NFL', 'NBA', 'NHL', 'MLB')
    AND l."lifecycleState"::text <> 'archived'
    AND l."tradeDeadlineWeek" IS NULL
    AND l.id <> '30349131-cb5e-4213-a1af-af27c31667fa'  -- jp's 14-Team NFL Redraft League: commissioner's call, left alone
    AND jsonb_typeof(l.settings->'commissionerSettings'->'tradeDeadlineWeek') IS DISTINCT FROM 'number'
)
SELECT id, name, sport, lifecycle_state, current_value, playoff_start_week, new_value, season_current_week
FROM candidates
WHERE new_value >= 1
  AND (season_current_week IS NULL OR season_current_week <= new_value)
ORDER BY sport, name, id;

-- ─── (b)-(d) THE BACKFILL — one transaction. Run only after reviewing (a). ──────────────────────────
BEGIN;

-- (b) Row cap: the preview on 2026-10-27 found 9 rows (10 before jp's league was excluded). Abort if more than 15 would change.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n
  FROM leagues l
  LEFT JOIN LATERAL (
    SELECT r."playoffStartWeek", r."currentWeek"
    FROM redraft_seasons r WHERE r."leagueId" = l.id ORDER BY r."createdAt" DESC LIMIT 1
  ) rs ON true
  WHERE lower(COALESCE(l.platform, '')) IN ('allfantasy', 'af', 'manual', 'native', '')
    AND lower(COALESCE(l."leagueType", 'redraft')) = 'redraft'
    AND lower(COALESCE(l.settings->>'league_type', 'redraft')) = 'redraft'
    AND (l."leagueVariant" IS NULL OR lower(l."leagueVariant") IN ('redraft', 'idp'))
    AND lower(COALESCE(l.settings->>'scoring_mode', 'points')) <> 'roto'
    AND COALESCE(l."bestBallMode", false) = false
    AND l.sport::text IN ('NFL', 'NBA', 'NHL', 'MLB')
    AND l."lifecycleState"::text <> 'archived'
    AND l."tradeDeadlineWeek" IS NULL
    AND l.id <> '30349131-cb5e-4213-a1af-af27c31667fa'  -- jp's 14-Team NFL Redraft League: commissioner's call, left alone
    AND jsonb_typeof(l.settings->'commissionerSettings'->'tradeDeadlineWeek') IS DISTINCT FROM 'number'
    AND COALESCE(rs."playoffStartWeek", l."playoffStartWeek") - 3 >= 1
    AND (rs."currentWeek" IS NULL OR rs."currentWeek" <= COALESCE(rs."playoffStartWeek", l."playoffStartWeek") - 3);
  IF n > 15 THEN
    RAISE EXCEPTION 'af_trade_deadline_default_20261027: % rows would change, cap is 15 — re-run the preview', n;
  END IF;
  RAISE NOTICE 'af_trade_deadline_default_20261027: % rows to change', n;
END $$;

-- (c) Pre-image: exactly the rows and the one column this changes, plus the value it writes.
CREATE TABLE af_trade_deadline_default_20261027 AS
SELECT
  l.id                                                     AS league_id,
  l."tradeDeadlineWeek"                                    AS old_trade_deadline_week,
  COALESCE(rs."playoffStartWeek", l."playoffStartWeek") - 3 AS new_trade_deadline_week,
  COALESCE(rs."playoffStartWeek", l."playoffStartWeek")    AS playoff_start_week,
  l.sport::text                                            AS sport,
  now()                                                    AS captured_at
FROM leagues l
LEFT JOIN LATERAL (
  SELECT r."playoffStartWeek", r."currentWeek"
  FROM redraft_seasons r WHERE r."leagueId" = l.id ORDER BY r."createdAt" DESC LIMIT 1
) rs ON true
WHERE lower(COALESCE(l.platform, '')) IN ('allfantasy', 'af', 'manual', 'native', '')
  AND lower(COALESCE(l."leagueType", 'redraft')) = 'redraft'
  AND lower(COALESCE(l.settings->>'league_type', 'redraft')) = 'redraft'
  AND (l."leagueVariant" IS NULL OR lower(l."leagueVariant") IN ('redraft', 'idp'))
  AND lower(COALESCE(l.settings->>'scoring_mode', 'points')) <> 'roto'
  AND COALESCE(l."bestBallMode", false) = false
  AND l.sport::text IN ('NFL', 'NBA', 'NHL', 'MLB')
  AND l."lifecycleState"::text <> 'archived'
  AND l."tradeDeadlineWeek" IS NULL
    AND l.id <> '30349131-cb5e-4213-a1af-af27c31667fa'  -- jp's 14-Team NFL Redraft League: commissioner's call, left alone
  AND jsonb_typeof(l.settings->'commissionerSettings'->'tradeDeadlineWeek') IS DISTINCT FROM 'number'
  AND COALESCE(rs."playoffStartWeek", l."playoffStartWeek") - 3 >= 1
  AND (rs."currentWeek" IS NULL OR rs."currentWeek" <= COALESCE(rs."playoffStartWeek", l."playoffStartWeek") - 3);

-- (d) The update, re-checking the captured state: a league is written only while its deadline is still
-- exactly what the pre-image captured (NULL) and no commissioner deadline has appeared since. The
-- block aborts the whole transaction unless every captured row was written and the cap still holds.
DO $$
DECLARE captured integer; written integer;
BEGIN
  SELECT count(*) INTO captured FROM af_trade_deadline_default_20261027;
  IF captured > 15 THEN
    RAISE EXCEPTION 'af_trade_deadline_default_20261027: pre-image holds % rows, cap is 15', captured;
  END IF;

  UPDATE leagues l
  SET "tradeDeadlineWeek" = p.new_trade_deadline_week
  FROM af_trade_deadline_default_20261027 p
  WHERE l.id = p.league_id
    AND l."tradeDeadlineWeek" IS NOT DISTINCT FROM p.old_trade_deadline_week
    AND jsonb_typeof(l.settings->'commissionerSettings'->'tradeDeadlineWeek') IS DISTINCT FROM 'number';
  GET DIAGNOSTICS written = ROW_COUNT;

  IF written <> captured THEN
    RAISE EXCEPTION 'af_trade_deadline_default_20261027: wrote % of % captured rows — state moved, nothing applied', written, captured;
  END IF;
  RAISE NOTICE 'af_trade_deadline_default_20261027: wrote % rows', written;
END $$;

COMMIT;
