-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- PHASE 0 · STEP 4 — Market board, ADP, and the three hardcoded nulls.  READ ONLY.
-- Run STEP 1 first and confirm `connected_database` = neondb.
--
-- ⚠ Q7 ERRORED on the first attempt because it ran against `mydb_shadow`, where
--   "PlayerValueSnapshot" does not exist. The table name below is correct — verified against
--   prisma/migrations/20260816220000_player_value_snapshot/migration.sql, which creates it with
--   that exact quoted CamelCase name. If it errors again on `neondb`, the migration was never
--   applied there and THAT is the finding.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

-- ── Q7 · The market board the value engine falls back to (FantasyCalc) ────────────────────────
-- `format` + `qbFormat` matter: pricing a 1QB redraft league off the superflex dynasty chart is
-- precisely the silent error the scarcity model exists to prevent.
-- This model has no @@map, so table and columns stay CamelCase and MUST remain double-quoted.
-- The timestamp is "capturedAt" — there is no createdAt on this model.
SELECT
  format,
  "qbFormat",
  source,
  COUNT(*)                    AS row_count,
  COUNT(DISTINCT "sleeperId") AS distinct_players,
  COUNT("tradeFrequency")     AS with_liquidity,
  COUNT("trend30d")           AS with_trend,
  MAX("capturedAt")           AS newest,
  NOW() - MAX("capturedAt")   AS staleness
FROM "PlayerValueSnapshot"
GROUP BY format, "qbFormat", source
ORDER BY row_count DESC;


-- ── Q8 · ADP — the only source Chimmy's described-trade evaluator can price from ───────────────
-- It is name-keyed, which is why prose ("is Chase for Gibbs fair?") can reach it at all.
-- Confirms or refutes the 94,089-row / 3,152-name figure quoted in describedTradeEvaluator.ts.
SELECT
  sport,
  format,
  scoring,
  COUNT(*)                    AS row_count,
  COUNT(DISTINCT player_name) AS distinct_names,
  COUNT(DISTINCT player_id)   AS distinct_ids,
  MAX(created_at)             AS newest
FROM adp_data
GROUP BY sport, format, scoring
ORDER BY row_count DESC
LIMIT 20;


-- ── Q9 · How many persisted trade snapshots were written UNGRADEABLE? ─────────────────────────
-- captureSnapshot.ts writes the sentinel 'NOT_GRADED' with fairness 0 when nothing on either side
-- resolved to a value. A high share is audit finding G2 measured in production rows.
SELECT
  grade,
  COUNT(*)                                  AS row_count,
  ROUND(AVG("confidenceScore")::numeric, 1) AS avg_confidence,
  ROUND(AVG("fairnessScore")::numeric, 1)   AS avg_fairness,
  MAX("createdAt")                          AS newest
FROM redraft_trade_value_snapshots
GROUP BY grade
ORDER BY row_count DESC;
