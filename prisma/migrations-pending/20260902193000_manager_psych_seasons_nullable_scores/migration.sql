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

-- ⚠ NOT INCLUDED, AND NOT AN OVERSIGHT: the columns still carry `DEFAULT 0`. Dropping NOT NULL
-- does not drop the default, so an INSERT that OMITS one of these columns still writes 0 rather
-- than NULL. Our writer names all fifteen columns explicitly, so nothing on the current path can
-- hit it — but a future writer that omits one would silently reintroduce exactly the bug above.
-- The hardening is `ALTER COLUMN "<col>" DROP DEFAULT` for the same five. It is handed to the
-- owner in §10.3 rather than applied here, because it is a schema change nobody has approved and
-- W4 says those are the owner's call.
