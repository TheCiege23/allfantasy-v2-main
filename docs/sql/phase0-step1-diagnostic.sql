-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- PHASE 0 · STEP 1 — RUN THIS FIRST, ALONE.  READ ONLY.
--
-- 🛑 WHY: the app connects to database `neondb`. If the Neon editor's database dropdown says
--    anything else (`mydb_shadow`, `mydb`, …) every query below runs against a different schema
--    and returns plausible-looking results — usually zeros — for the wrong artifact.
--
--    That already happened once: a census run against `mydb_shadow` reported six statements
--    "executed successfully" and one error. The error was the honest signal; the six successes
--    were the misleading ones.
--
-- HOW TO READ IT: `connected_database` MUST say `neondb`. If it does not, change the database in
-- the editor's dropdown (top right, beside the branch selector) and re-run before going on.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

SELECT
  current_database()                                        AS connected_database,
  CASE WHEN current_database() = 'neondb'
       THEN '✅ correct database'
       ELSE '🛑 WRONG DATABASE — switch to neondb and re-run'
  END                                                       AS verdict,
  current_schema()                                          AS schema,
  (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema = 'public')                         AS tables_in_schema;


-- ── Which of the tables this census needs actually exist here, and are they populated? ────────
-- A table that is missing OR empty changes what Phase 1 can do, so both are reported.
-- `n_live_tup` is Postgres' own row estimate — free, no table scan, so this costs essentially
-- nothing even on the large tables.
SELECT
  t.expected                                                       AS table_name,
  CASE WHEN c.relname IS NULL THEN '🛑 MISSING' ELSE '✅ exists' END AS presence,
  COALESCE(s.n_live_tup, 0)                                        AS approx_rows
FROM (VALUES
  ('AFProjectionSnapshot'),
  ('fantasy_projections'),
  ('PlayerValueSnapshot'),
  ('adp_data'),
  ('redraft_trade_value_snapshots'),
  ('sync_job_runs'),
  ('fantasy_stat_lines'),
  ('player_game_stats')
) AS t(expected)
LEFT JOIN pg_class c
       ON c.relname = t.expected
      AND c.relnamespace = 'public'::regnamespace
      AND c.relkind = 'r'
LEFT JOIN pg_stat_user_tables s
       ON s.relname = t.expected
      AND s.schemaname = 'public'
ORDER BY presence DESC, approx_rows DESC;
