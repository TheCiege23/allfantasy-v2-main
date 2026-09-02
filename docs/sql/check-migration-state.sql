-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- Migration state check.  READ ONLY.  Run in the Neon SQL editor on `neondb`.
--
-- 🛑 EVERY STATEMENT IS A SELECT. Nothing here creates, alters or drops anything.
--
-- WHY: `20260831_tournament_grants` was moved out of `prisma/migrations/` and into
-- `prisma/migrations-pending/`. That is correct IF it was never applied — which its own header
-- asserts ("PARKED, NOT APPLIED") and which nothing in the codebase contradicts: no Prisma model,
-- no query, no reference to `tournament_shell_grants` anywhere in lib/ or app/.
--
-- But an assertion in a comment is not a measurement. If it HAD been applied, moving the directory
-- means `_prisma_migrations` now records a migration Prisma can no longer see, and
-- `prisma migrate status` will report drift. These queries settle it.
-- ═════════════════════════════════════════════════════════════════════════════════════════════


-- ══ Q1 · Was the tournament migration ever applied? ═══════════════════════════════════════════
-- EXPECT: zero rows. That confirms the move was safe and nothing further is needed.
--
-- If it returns a row, tell me — the migration should go back into prisma/migrations/ so Prisma's
-- history stays consistent with the database, and the fix is to move it back, not to delete the
-- row.
SELECT
  migration_name,
  started_at,
  finished_at,
  rolled_back_at,
  CASE
    WHEN finished_at IS NOT NULL                       THEN '🛑 APPLIED — move it back to prisma/migrations/'
    WHEN rolled_back_at IS NOT NULL                    THEN 'rolled back'
    ELSE '🛑 STARTED BUT NEVER FINISHED — this blocks every future deploy with P3009'
  END AS verdict
FROM _prisma_migrations
WHERE migration_name LIKE '%tournament_grants%';


-- ══ Q2 · Does the table exist, regardless of migration history? ═══════════════════════════════
-- A belt-and-braces check: someone could have created it by hand. EXPECT: zero rows.
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'tournament_shell_grants';


-- ══ Q3 · Any migration stuck half-applied? ════════════════════════════════════════════════════
-- 🛑 THE ONE THAT BLOCKS EVERYTHING. A migration that failed — INCLUDING one that failed
-- correctly on a guard — leaves `finished_at IS NULL`, and every later `migrate deploy` then
-- aborts with P3009 until a human resolves it. Worth knowing BEFORE you apply the ROS migration.
--
-- EXPECT: zero rows.
SELECT
  migration_name,
  started_at,
  logs
FROM _prisma_migrations
WHERE finished_at IS NULL
  AND rolled_back_at IS NULL
ORDER BY started_at DESC;


-- ══ Q4 · The two untracked migrations I did NOT move — were they applied? ═════════════════════
-- `20260830160000_fantrax_league_source_id` and `20260830190000_devy_head_coach_context` are
-- untracked in git but carry NO "parked" header, and the migrations-pending README describes the
-- Fantrax one as work that was handed over for application. So they look applied-but-uncommitted,
-- not parked-by-mistake — and I left them alone rather than guess.
--
-- EXPECT: both present with a finished_at. If either is MISSING, it is a parked migration sitting
-- in the live deploy path and would ride along on your next deploy — tell me and I will park it.
SELECT
  migration_name,
  finished_at,
  CASE WHEN finished_at IS NOT NULL
       THEN 'applied — correctly in prisma/migrations/'
       ELSE '🛑 not applied — it is in the live deploy path and would ride along'
  END AS verdict
FROM _prisma_migrations
WHERE migration_name IN (
  '20260830160000_fantrax_league_source_id',
  '20260830190000_devy_head_coach_context'
)
ORDER BY migration_name;


-- ══ Q5 · Do the ROS columns already exist? ════════════════════════════════════════════════════
-- Confirms the state before you apply `20260901230000_af_projection_ros`.
-- EXPECT: zero rows before applying, two rows after.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'AFProjectionSnapshot'
  AND column_name IN ('rosProjection', 'rosWeeksRemaining')
ORDER BY column_name;
