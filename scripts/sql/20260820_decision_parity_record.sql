-- Decision OS — durable parity telemetry
--
-- WHY THIS EXISTS
-- `summarizeFlipReadiness` decides a surface is ready to leave shadow mode when agreement holds at
-- >=95% over >=50 REAL comparisons. It reads `telemetryDebugStore`, which is an in-memory array
-- capped at 500 entries. On Vercel every invocation has its own memory: the array starts empty on
-- each cold start and is never shared between instances, so the gate can never accumulate the 50
-- comparisons it requires. Meanwhile the emitter falls through to console.log, sending the evidence
-- to the log drain where nothing can query it.
--
-- Parity data has been generated and discarded since shadow mode began. That is why no surface has
-- ever flipped. This table is where it goes instead.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ⚠ WHY THIS LIVES IN scripts/sql/ AND NOT UNDER prisma/migrations/
-- Prisma treats EVERY directory under prisma/migrations/ as a migration and requires each one to
-- contain a file named exactly `migration.sql`. A folder holding hand-applied SQL under any other
-- name fails `migrate` with P3015 ("Could not find the migration file"), which breaks the required
-- `Platform Backend Deploy Readiness` check for the whole repo -- not just for the branch that
-- added it. Do not move this back. scripts/sql/ is where this repo already keeps hand-applied DDL.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- HOW TO APPLY  (do NOT use `prisma migrate deploy` against production)
--
--   1. Read it. It creates one table and three indexes; it alters nothing that exists.
--   2. Apply to the TEST database first and confirm the app still boots:
--        psql "$TEST_DATABASE_URL" -f scripts/sql/20260820_decision_parity_record.sql
--   3. Apply to production during a quiet window.
--   4. Run `npx prisma generate` so the client gains the `decisionParityRecord` delegate.
--
-- ⚠ On Windows, `psql "$DIRECT_URL"` can silently connect to localhost instead of Neon. Confirm the
--   target with `SELECT current_database(), inet_server_addr();` before running this.
--
-- SAFETY
--   - Purely additive: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS. No ALTER, no DROP,
--     no data movement. Re-running is a no-op.
--   - The application degrades honestly BEFORE this is applied: `listPersistedParityEvents` returns
--     [] when the delegate is absent, and the sink's write is fire-and-forget with a swallowed
--     rejection. Deploying the code without this migration changes nothing user-visible.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "decision_parity_record" (
  "id"           TEXT         NOT NULL,
  -- 'decision.shadow_parity' | 'decision.validator_parity'. Only these two are stored; the other
  -- telemetry events are high-frequency and have no bearing on the flip decision.
  "event"        VARCHAR(64)  NOT NULL,
  "decisionType" VARCHAR(64)  NOT NULL,
  -- The flip gate is evaluated PER SURFACE, not per decision type, so this is part of the grouping
  -- key rather than a detail buried in `flags`.
  "surface"      VARCHAR(64),
  "decisionId"   VARCHAR(64),
  "leagueId"     VARCHAR(64),
  "userId"       VARCHAR(64),
  -- NULLABLE ON PURPOSE. NULL means the event carried no agreement signal — a comparison WITHOUT a
  -- verdict. Those are reported separately and must never be counted as agreement, which is exactly
  -- what a NOT NULL DEFAULT false would silently do.
  "agreement"    BOOLEAN,
  "flags"        JSONB,
  "recordedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "decision_parity_record_pkey" PRIMARY KEY ("id")
);

-- The gate's own query shape: group by (decisionType, surface), newest first.
CREATE INDEX IF NOT EXISTS "decision_parity_record_type_surface_recorded_idx"
  ON "decision_parity_record" ("decisionType", "surface", "recordedAt");

-- Reading one event family across all surfaces.
CREATE INDEX IF NOT EXISTS "decision_parity_record_event_recorded_idx"
  ON "decision_parity_record" ("event", "recordedAt");

-- Triaging divergences for a specific league, which the gate requires before a flip.
CREATE INDEX IF NOT EXISTS "decision_parity_record_league_recorded_idx"
  ON "decision_parity_record" ("leagueId", "recordedAt");

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- RETENTION
-- Shadow parity fires once per decision, so this table grows with usage. It is append-only
-- evidence, not state: nothing breaks if old rows are removed. Once a surface has flipped, its
-- history is answered — prune on a schedule rather than letting it grow unbounded:
--
--   DELETE FROM "decision_parity_record" WHERE "recordedAt" < NOW() - INTERVAL '90 days';
-- ─────────────────────────────────────────────────────────────────────────────────────────────
