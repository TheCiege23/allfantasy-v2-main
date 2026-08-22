-- Lineup OS — maintained fact state for manager.lineup.set
--
-- WHY
-- The lineup decision derives its grounding facts on every request: computeLineupActionsForUser
-- fans out across a user's leagues and rosters, and the warehouse/signal loaders query the ports
-- inline. That is why the shadow sweep is capped at 3 users on a 20s budget, and it is the same
-- shape as the unbounded per-league fan-out that previously took production Postgres to an OOM
-- (53200). This table holds those facts so the decision layer reads instead of derives.
--
-- ⚠ WHY THIS LIVES IN scripts/sql/ AND NOT UNDER prisma/migrations/
-- Prisma treats EVERY directory under prisma/migrations/ as a migration and requires each to
-- contain a file named exactly `migration.sql`. Hand-applied SQL in a differently named folder
-- fails `migrate` with P3015 and breaks the required Platform Backend Deploy Readiness check for
-- the WHOLE repo, not just the branch that added it. That happened on 2026-08-20. Do not move this.
--
-- HOW TO APPLY (do NOT use `prisma migrate deploy` against production)
--   1. Read it: one table, two indexes, no ALTER, no DROP. Re-running is a no-op.
--   2. Test first:  psql "$TEST_DATABASE_URL" -f scripts/sql/20260822_lineup_os_facts.sql
--   3. Then production, then `npx prisma generate`.
--
-- ⚠ On Windows `psql "$DIRECT_URL"` can silently connect to localhost. Confirm with
--   SELECT current_database(), inet_server_addr(); before running.
--
-- SAFE BEFORE IT IS APPLIED: every store method checks for the delegate and returns "no cached
-- facts" when it is absent, so the read path falls through to live derivation exactly as today.

CREATE TABLE IF NOT EXISTS "lineup_os_facts" (
  "id"         TEXT        NOT NULL,
  "leagueId"   VARCHAR(64) NOT NULL,
  "sport"      VARCHAR(32) NOT NULL,
  -- 'warehouse' (season/matchup history, per user) | 'signal' (injury/bye/projection, per week).
  -- Separate kinds because they decay at completely different rates; see LINEUP_OS_TTL_MS.
  "kind"       VARCHAR(16) NOT NULL,
  -- Discriminator within the league: 'user:<id>' for warehouse, 'week:<n>' for signal.
  "scopeKey"   VARCHAR(96) NOT NULL,
  "facts"      JSONB       NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "lineup_os_facts_pkey" PRIMARY KEY ("id")
);

-- The read path's exact lookup, and what makes a write an upsert rather than an append.
CREATE UNIQUE INDEX IF NOT EXISTS "lineup_os_facts_leagueId_kind_scopeKey_key"
  ON "lineup_os_facts" ("leagueId", "kind", "scopeKey");

-- For pruning and for answering "is this store being kept warm at all".
CREATE INDEX IF NOT EXISTS "lineup_os_facts_capturedAt_idx"
  ON "lineup_os_facts" ("capturedAt");

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- RETENTION
-- Expiry is enforced on READ against LINEUP_OS_TTL_MS, never by a sweeper — a sweeper that stops
-- running would leave expired rows servable, which is the one failure mode this design refuses to
-- have. Old rows are therefore harmless, merely wasteful, and can be pruned whenever:
--
--   DELETE FROM "lineup_os_facts" WHERE "capturedAt" < NOW() - INTERVAL '7 days';
-- ─────────────────────────────────────────────────────────────────────────────────────────────
