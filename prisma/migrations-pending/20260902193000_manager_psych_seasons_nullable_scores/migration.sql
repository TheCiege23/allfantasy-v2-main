-- R4b.3 — the five psychology score columns must permit NULL.
--
-- ✅ ALREADY APPLIED TO PRODUCTION 2026-09-02, BY THE OWNER, AS RAW SQL.
-- Verified by effect via `information_schema`: all five report is_nullable = YES, and
-- `sampleSize` correctly still reports NO.
--
-- 🛑 SO THIS IS A BACKFILL OF THE MIGRATION HISTORY, NOT A PENDING CHANGE — the same third case
-- as `20260901220000_domain_os_facts` and `20260902060000_manager_psych_seasons`. Applied by
-- hand, so there is **no `_prisma_migrations` row**, so a future `migrate deploy` will RUN it
-- rather than skip it. `DROP NOT NULL` on an already-nullable column succeeds and changes
-- nothing, so that run is a no-op that finally records the row. Self-healing by construction.
--
-- ⚠ DELIBERATELY A SEPARATE FILE RATHER THAN AN EDIT TO THE CREATE TABLE. The earlier migration
-- is a record of what was applied, and rewriting its column definitions would make that record
-- lie. On a fresh database the two run in order — CREATE with NOT NULL, then this drops it — and
-- the end state matches production either way.
--
-- ── 🛑 WHY: `?? 0` STORED "NEVER MEASURED" AS "MEASURED, AND THE ANSWER WAS ZERO" ────────────
--
-- The columns were `NOT NULL DEFAULT 0` and `writeProfileSeasonSnapshot` coalesced with `?? 0`,
-- so a manager who was never assessed for aggression was recorded as maximally passive. That is
-- precisely the failure the evidence floor exists to prevent, and it is already handled correctly
-- one module over: `PsychologyProfileFact.scores` in `lib/decision-os/psychology-os/index.ts` is
-- `number | null` with a comment naming this exact bug. The snapshot table broke the pattern.
--
-- Measured on the first 97 production rows before the fix: 68 carried a non-zero aggression
-- score and nothing distinguished the other 29 from genuinely passive managers. The information
-- was destroyed at write time, so no query recovers it — those rows correct themselves as each
-- manager's next refresh upserts over them.
--
-- ⚠ `sampleSize` IS DELIBERATELY ABSENT FROM THIS LIST. Zero observations is a real, measured
-- answer; zero aggression is not. That asymmetry is the entire point, and dropping NOT NULL on
-- `sampleSize` too would erase the distinction this migration exists to draw.

ALTER TABLE "manager_psych_profile_seasons"
  ALTER COLUMN "aggressionScore"     DROP NOT NULL,
  ALTER COLUMN "activityScore"       DROP NOT NULL,
  ALTER COLUMN "tradeFrequencyScore" DROP NOT NULL,
  ALTER COLUMN "waiverFocusScore"    DROP NOT NULL,
  ALTER COLUMN "riskToleranceScore"  DROP NOT NULL;

-- ── 🛑 AND THE DEFAULT MUST GO TOO — DROPPING NOT NULL IS ONLY HALF THE FIX ─────────────────
--
-- `DROP NOT NULL` does not drop the default. So after the statement above the columns permitted
-- NULL but still carried `DEFAULT 0`, and an INSERT that OMITS one of them wrote 0 rather than
-- NULL — the original bug, still fully armed, just waiting for a writer that names fourteen
-- columns instead of fifteen. Our current writer names all fifteen, which is exactly what makes
-- this the kind of trap that survives review: nothing on the live path can trigger it today.
--
-- ✅ APPLIED TO PRODUCTION 2026-09-02 on the owner's instruction, immediately after the statement
-- above. Verified three ways rather than by reading the ALTER's own success:
--   * `information_schema` reports column_default = NULL for all five, and still `0` for sampleSize
--   * row count 97 before and 97 after — DDL touched no data
--   * a behavioural probe, which is the only one that proves the CHANGE rather than the catalog:
--       BEGIN; INSERT … (id, leagueId, managerId, sport, season, sampleSize)  -- aggressionScore OMITTED
--       SELECT "aggressionScore"  ->  NULL          (was 0 before this statement); ROLLBACK;
--
-- ⚠ `sampleSize` KEEPS ITS `DEFAULT 0`, deliberately, for the same reason it kept NOT NULL: zero
-- observations is a real, measured answer. Dropping its default would make an omitted sampleSize
-- indistinguishable from an unmeasured one, which is the very confusion this file exists to end.

ALTER TABLE "manager_psych_profile_seasons"
  ALTER COLUMN "aggressionScore"     DROP DEFAULT,
  ALTER COLUMN "activityScore"       DROP DEFAULT,
  ALTER COLUMN "tradeFrequencyScore" DROP DEFAULT,
  ALTER COLUMN "waiverFocusScore"    DROP DEFAULT,
  ALTER COLUMN "riskToleranceScore"  DROP DEFAULT;
