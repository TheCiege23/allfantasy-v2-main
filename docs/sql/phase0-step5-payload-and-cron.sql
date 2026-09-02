-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- PHASE 0 · STEP 5 — The three nulls in real rows, and cron health.  READ ONLY.
-- Run STEP 1 first and confirm `connected_database` = neondb.
--
-- ⚠ Skip Q10 if STEP 4's Q9 returned zero rows — there are no snapshots to expand, and the JSON
--   walk would just return zeros that look like a finding rather than an empty table.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

-- ── Q10 · The three hardcoded nulls, measured ─────────────────────────────────────────────────
-- EXPECT has_market = 0, has_idp = 0, has_ranking = 0. That is audit finding G2 in production data.
-- `has_projection` says whether even the ONE source the write path populates is arriving — it reads
-- metadata.restOfSeasonProjection, which the CLIENT must have supplied, so it is easy to be absent.
-- `priced_at_zero` counts players the engine could not price at all.
-- Bounded to the 500 newest snapshots so the JSON expansion stays cheap.
WITH recent AS (
  SELECT payload
  FROM redraft_trade_value_snapshots
  ORDER BY "createdAt" DESC
  LIMIT 500
),
assets AS (
  SELECT jsonb_array_elements(
           jsonb_array_elements(r.payload::jsonb -> 'sides') -> 'assets'
         ) AS a
  FROM recent r
)
SELECT
  COUNT(*)                                                                  AS player_assets,
  COUNT(*) FILTER (WHERE a -> 'sources' ->> 'projectionValue'  IS NOT NULL) AS has_projection,
  COUNT(*) FILTER (WHERE a -> 'sources' ->> 'adpValue'         IS NOT NULL) AS has_adp,
  COUNT(*) FILTER (WHERE a -> 'sources' ->> 'fantasyCalcValue' IS NOT NULL) AS has_market,
  COUNT(*) FILTER (WHERE a -> 'sources' ->> 'idpValue'         IS NOT NULL) AS has_idp,
  COUNT(*) FILTER (WHERE a -> 'sources' ->> 'rankingValue'     IS NOT NULL) AS has_ranking,
  COUNT(*) FILTER (WHERE (a ->> 'internalValue')::numeric = 0)              AS priced_at_zero
FROM assets
WHERE a ->> 'kind' = 'player';


-- ── Q11 · Cron health for the projection writer and its upstreams ─────────────────────────────
-- If compute-projections is failing or has not run, every number in STEP 2 is stale and Phase 1
-- would be wiring up a frozen table. This model maps to snake_case: job_name, started_at.
SELECT
  job_name,
  status,
  COUNT(*)                AS runs,
  SUM(rows_written)       AS total_rows_written,
  MAX(started_at)         AS last_run,
  NOW() - MAX(started_at) AS since_last_run
FROM sync_job_runs
WHERE job_name IN (
  'cron-compute-projections',
  'cron-import-stat-lines',
  'cron-adp-refresh'
)
GROUP BY job_name, status
ORDER BY job_name, runs DESC;
