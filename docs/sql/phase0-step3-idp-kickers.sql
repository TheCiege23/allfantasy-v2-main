-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- PHASE 0 · STEP 3 — IDP coverage, basis mix, and the kicker hole.  READ ONLY.
-- Run STEP 1 first and confirm `connected_database` = neondb.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

-- ── Q4 · Does the AF engine cover DEFENDERS? 🛑 THE MOST IMPORTANT QUERY IN THE CENSUS ────────
-- READ `with_component_amounts`. Those are the rows `rescoreIdpForLeague()` can re-price under a
-- league's own scoring rules. If it is 0, then Phase 1.4 is a no-op and the whole "one canonical
-- IDP projection, rescored per league" design has nothing stored to work from — which would
-- change the plan, not just delay it.
SELECT
  position,
  COUNT(*)                                                          AS row_count,
  COUNT(*) FILTER (
    WHERE "adjustmentFactors" -> 'idp' IS NOT NULL
  )                                                                 AS with_idp_breakdown,
  COUNT(*) FILTER (
    WHERE "adjustmentFactors" -> 'idp' -> 'componentAmounts' IS NOT NULL
  )                                                                 AS with_component_amounts,
  ROUND(AVG("afProjection")::numeric, 2)                            AS avg_projection,
  ROUND(MAX("afProjection")::numeric, 2)                            AS max_projection
FROM "AFProjectionSnapshot"
WHERE sport = 'NFL'
  AND position IN ('LB','OLB','ILB','MLB','DB','CB','S','SS','FS','DL','DT','DE','NT','EDGE')
GROUP BY position
ORDER BY row_count DESC;


-- ── Q5 · Which basis is winning? ──────────────────────────────────────────────────────────────
-- A healthy in-season NFL run should be dominated by `sleeper_weekly_projection` and
-- `weekly_actuals_recency`. Heavy `season_dk_fppg_proxy` means we are mostly serving a PRIOR
-- SEASON DraftKings proxy as a projection — legitimate and labelled, but it overstates non-PPR
-- leagues and it is not a forecast of this season.
SELECT
  sport,
  "adjustmentFactors" ->> 'basis'   AS basis,
  "confidenceLevel",
  COUNT(*)                          AS row_count
FROM "AFProjectionSnapshot"
GROUP BY sport, basis, "confidenceLevel"
ORDER BY sport, row_count DESC;


-- ── Q6 · KICKERS — measuring audit finding P1 ─────────────────────────────────────────────────
-- The projection engine has NO kicker scoring path. Any rows here reached a basis never designed
-- for kickers. The interesting part is the spread: if min ≈ max, there is no real signal and every
-- kicker is effectively interchangeable, which is what the flat `kicker-flat` value already assumes.
SELECT
  position,
  "adjustmentFactors" ->> 'basis'         AS basis,
  COUNT(*)                                AS row_count,
  ROUND(AVG("afProjection")::numeric, 2)  AS avg_projection,
  ROUND(MIN("afProjection")::numeric, 2)  AS min_projection,
  ROUND(MAX("afProjection")::numeric, 2)  AS max_projection
FROM "AFProjectionSnapshot"
WHERE position IN ('K','PK','P')
GROUP BY position, basis
ORDER BY row_count DESC;
