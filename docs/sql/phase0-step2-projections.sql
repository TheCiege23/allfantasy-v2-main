-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- PHASE 0 · STEP 2 — The projection disconnect.  READ ONLY.
-- Run STEP 1 first and confirm `connected_database` = neondb.
--
-- THE QUESTION: the AF calculator writes `AFProjectionSnapshot`. The trade-value engine reads
-- `fantasy_projections`. These three queries measure the gap between them.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

-- ── Q1 · Is the AF calculator producing rows, and how fresh? ──────────────────────────────────
-- READ `staleness`: the cron runs "50 7 * * *", so > ~2 days means it is failing or unscheduled.
-- READ `week_null_rows`: ncaafProjections.ts:41 claims every NCAAF row is week=NULL from a manual
-- backfill. If true, college projections are a frozen snapshot, not a computed one.
SELECT
  sport,
  season,
  COUNT(*)                                    AS row_count,
  COUNT(*) FILTER (WHERE week IS NULL)        AS week_null_rows,
  COUNT(*) FILTER (WHERE week IS NOT NULL)    AS week_scoped_rows,
  COUNT(DISTINCT "playerId")                  AS distinct_players,
  ROUND(AVG("afProjection")::numeric, 2)      AS avg_af_projection,
  MAX("computedAt")                           AS newest_computed,
  NOW() - MAX("computedAt")                   AS staleness
FROM "AFProjectionSnapshot"
GROUP BY sport, season
ORDER BY sport, season DESC;


-- ── Q2 · The table the value engine ACTUALLY reads today ──────────────────────────────────────
-- READ `expired_rows`: this model carries `expires_at`. Rows past it are stale by the table's own
-- definition, so a big expired share means the value engine reads data that is out of date on its
-- own terms — not merely smaller than the AF table.
SELECT
  sport,
  season,
  week,
  scoring_preset_id,
  COUNT(*)                                    AS row_count,
  COUNT(DISTINCT player_id)                   AS distinct_players,
  COUNT(*) FILTER (WHERE expires_at < NOW())  AS expired_rows,
  ROUND(AVG(projected_points)::numeric, 2)    AS avg_points,
  MAX(updated_at)                             AS newest_row
FROM fantasy_projections
GROUP BY sport, season, week, scoring_preset_id
ORDER BY sport, season DESC, week DESC
LIMIT 30;


-- ── Q3 · The headline number, one row ─────────────────────────────────────────────────────────
-- If af_projection_rows >> fantasy_projection_live_rows, Phase 1 moves the value engine off a
-- near-empty table onto a populated one. That is the entire thesis of the audit as a number.
SELECT
  (SELECT COUNT(*) FROM "AFProjectionSnapshot")                        AS af_projection_rows,
  (SELECT COUNT(*) FROM fantasy_projections)                           AS fantasy_projection_rows,
  (SELECT COUNT(*) FROM fantasy_projections WHERE expires_at >= NOW()) AS fantasy_projection_live_rows,
  (SELECT COUNT(DISTINCT "playerId") FROM "AFProjectionSnapshot")      AS af_distinct_players,
  (SELECT COUNT(DISTINCT player_id) FROM fantasy_projections)          AS fp_distinct_players;
