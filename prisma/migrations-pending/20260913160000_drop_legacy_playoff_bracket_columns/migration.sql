-- Drop nine legacy playoff bracket columns, and one index, that exist only in production.
--
-- 🛑 PARKED. This lives in prisma/migrations-pending/ because applying it to production has NOT
-- been authorised yet. Move it to prisma/migrations/ only as part of that authorised apply (see
-- that directory's README for why the directory, not git, is the deploy path).
--
-- ── WHERE THE COLUMNS CAME FROM ─────────────────────────────────────────────────────────────────
-- ac55adee0 (2026-05-13, "NBA/NHL bracket scoring system") added all nine to schema.prisma. That
-- commit NEVER MERGED to main — it exists only on origin/feat/p2-production-hardening — and no
-- migration creates these columns, so they reached production by a `prisma db push` from that
-- branch. main took a different design four days later: ead008586 added home_team_wins /
-- away_team_wins through 20260517005000_playoff_series_provider_metadata, and scoring is computed
-- at read time in lib/playoffs/playoffScoring.ts. schema.prisma on main has never declared them,
-- so the generated client cannot read or write them. Nothing on main references them in raw SQL,
-- and production has no view, function or trigger that does.
--
-- ── WHAT THEY HOLD, MEASURED ON PRODUCTION 2026-09-13 (read-only) ───────────────────────────────
--   playoff_bracket_entries (23 rows)
--     total_score     all 0          correct_picks   all 0          is_locked   all false
--     rank            all NULL       submitted_at    2 non-null, both test-mode entries (below)
--   playoff_bracket_picks (123 rows)
--     points_awarded  all 0          is_correct      all NULL
--   playoff_bracket_series (390 rows)
--     home_wins       all 0          away_wins       all 0
--       (the live columns home_team_wins / away_team_wins differ on 24 series: these never got a write)
--   index playoff_bracket_entries_challenge_id_total_score_idx (challenge_id, total_score)
--     1,247 scans, taken for its challenge_id prefix — playoff_bracket_entries_challenge_id_idx
--     shows 0 because the planner preferred this one. Dropping it moves those lookups there.
--
-- The only non-default values, preserved here and restored by ROLLBACK.sql. Stored as
-- `timestamp(3) without time zone` on a GMT server; this is the ::text form, not a JS Date.
--   cmp4ps6bu000123c97q9s92cr  submitted_at 2026-05-14 00:04:54.027  (NBA 2026, is_test_mode, 15 picks)
--   cmp4qav8f0001t53xto3e25pl  submitted_at 2026-05-14 00:08:47.82   (NHL 2026, is_test_mode, 15 picks)
--
-- ⚠ CORRECTS 20260719000000_canonical_player_team_foundation, whose header calls these columns
-- "real production data" and leaves them alone. They were never opened to check; the measurement
-- above is the check. That file is applied, so its checksum is recorded — it is NOT edited.
--
-- ── WHY IT IS SHAPED THIS WAY ───────────────────────────────────────────────────────────────────
-- 1. THE GUARD RUNS FIRST AND THE DROP DEPENDS ON IT. If any column holds something other than
--    what was measured above, the whole migration raises and drops nothing. A drop justified by a
--    measurement must re-check the measurement at the moment it runs, not trust a comment.
-- 2. EVERYTHING IS `IF EXISTS`. No migration ever created these columns, so a shadow database or
--    a fresh clone replaying the history has none of them. There the guard skips each missing
--    column and every drop is a no-op, instead of failing and writing a P3009 row.
-- 3. schema.prisma DOES NOT CHANGE. It already lacks these columns; this makes production match.
--    Afterwards `npm run db:drift` reports these 10 baseline items as resolved; tighten the baseline
--    with `npm run db:drift:baseline` in a reviewed PR once this is applied, not before.
--
-- Rehearsed on production 2026-09-13 inside transactions that were rolled back; see the PR.

DO $$
DECLARE
  chk record;
  bad bigint;
BEGIN
  FOR chk IN
    SELECT * FROM (VALUES
      ('playoff_bracket_entries', 'total_score',    'total_score <> 0'),
      ('playoff_bracket_entries', 'correct_picks',  'correct_picks <> 0'),
      ('playoff_bracket_entries', 'is_locked',      'is_locked'),
      ('playoff_bracket_entries', 'rank',           'rank IS NOT NULL'),
      ('playoff_bracket_entries', 'submitted_at',   $q$submitted_at IS NOT NULL AND id NOT IN ('cmp4ps6bu000123c97q9s92cr', 'cmp4qav8f0001t53xto3e25pl')$q$),
      ('playoff_bracket_picks',   'points_awarded', 'points_awarded <> 0'),
      ('playoff_bracket_picks',   'is_correct',     'is_correct IS NOT NULL'),
      ('playoff_bracket_series',  'home_wins',      'home_wins <> 0'),
      ('playoff_bracket_series',  'away_wins',      'away_wins <> 0')
    ) AS t(tbl, col, predicate)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = chk.tbl AND column_name = chk.col
    ) THEN
      EXECUTE format('SELECT count(*) FROM %I WHERE %s', chk.tbl, chk.predicate) INTO bad;
      IF bad > 0 THEN
        RAISE EXCEPTION 'refusing to drop %.%: % row(s) match (%), which was empty when measured on 2026-09-13. Re-scope before dropping.',
          chk.tbl, chk.col, bad, chk.predicate;
      END IF;
    END IF;
  END LOOP;
END $$;

DROP INDEX IF EXISTS "playoff_bracket_entries_challenge_id_total_score_idx";

ALTER TABLE "playoff_bracket_entries"
  DROP COLUMN IF EXISTS "total_score",
  DROP COLUMN IF EXISTS "correct_picks",
  DROP COLUMN IF EXISTS "rank",
  DROP COLUMN IF EXISTS "submitted_at",
  DROP COLUMN IF EXISTS "is_locked";

ALTER TABLE "playoff_bracket_picks"
  DROP COLUMN IF EXISTS "points_awarded",
  DROP COLUMN IF EXISTS "is_correct";

ALTER TABLE "playoff_bracket_series"
  DROP COLUMN IF EXISTS "home_wins",
  DROP COLUMN IF EXISTS "away_wins";
