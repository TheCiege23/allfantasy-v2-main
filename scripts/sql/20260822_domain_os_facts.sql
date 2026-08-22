-- Domain OS — maintained grounding facts that FEED Decision OS
--
-- WHY
-- Decision OS should decide, not gather. Each domain (lineup, waiver, trade) maintains the facts
-- its decisions need and Decision OS reads them, instead of assembling a world on every request.
-- The cost of deriving per request is not theoretical: computeLineupActionsForUser fans out across
-- a user's leagues and rosters per call -- why the shadow sweep runs 3 users on a 20s budget -- and
-- it is the same shape as the unbounded per-league fan-out that took production Postgres to an OOM
-- (53200).
--
-- ONE TABLE, PARTITIONED BY DOMAIN. Three domains would otherwise mean three near-identical
-- tables; the fact envelope is identical for all of them.
--
-- `level` is app | league | user, matching the three levels the repo already models in
-- AfAppLearningSnapshot / AfLeagueLearningSnapshot / AfUserLearningProfile. `confidence` and
-- `sampleSize` mirror that trio: a fact drawn from 2 games and one from 200 are not the same fact,
-- and without the sample attached a consumer cannot tell them apart.
--
-- NEVER SERVES STALE FACTS. Entries past their per-kind TTL are reported ABSENT on read and the
-- caller derives live. Expiry is enforced on READ, never by a sweeper -- a sweeper that stops
-- running would leave expired rows servable, which is the one failure this design refuses to have.
-- That matters concretely: every scheduled job in this repo is currently dead.
--
-- WHY THIS LIVES IN scripts/sql/ AND NOT UNDER prisma/migrations/
-- Prisma treats EVERY directory under prisma/migrations/ as a migration requiring a file named
-- exactly `migration.sql`. Hand-applied SQL in a differently named folder fails `migrate` with
-- P3015 and breaks the required Platform Backend Deploy Readiness check for the WHOLE repo, not
-- just the branch that added it. That happened on 2026-08-20. Do not move this.
--
-- HOW TO APPLY (do NOT use `prisma migrate deploy` against production)
--   1. Read it: one table, three indexes, no ALTER, no DROP. Re-running is a no-op.
--   2. Test first:  psql "$TEST_DATABASE_URL" -f scripts/sql/20260822_domain_os_facts.sql
--   3. Then production, then `npx prisma generate`.
-- On Windows `psql "$DIRECT_URL"` can silently hit localhost. Confirm the target first with
--   SELECT current_database(), inet_server_addr();
--
-- SAFE BEFORE IT IS APPLIED: every store method checks for the delegate and reports no cached
-- facts, so each feed falls through to live derivation exactly as today.

CREATE TABLE IF NOT EXISTS "domain_os_facts" (
  "id"         TEXT         NOT NULL,
  -- 'lineup' | 'waiver' | 'trade'
  "domain"     VARCHAR(16)  NOT NULL,
  -- Fact family within the domain: 'warehouse' | 'signal' | 'settings' | 'resource' | 'rosters'.
  -- Separate kinds because they decay at very different rates; one TTL would have to be tuned to
  -- the fastest input and would waste the slowest.
  "kind"       VARCHAR(32)  NOT NULL,
  -- 'app' | 'league' | 'user'
  "level"      VARCHAR(8)   NOT NULL,
  -- Address within the level: a sport, a league id, a user+league pair, an ordered roster pair.
  "scopeKey"   VARCHAR(128) NOT NULL,
  "sport"      VARCHAR(16)  NOT NULL,
  "facts"      JSONB        NOT NULL,
  -- NULLABLE ON PURPOSE. NULL means the producer does not express confidence for this fact --
  -- never zero-as-unknown, which would read as "no confidence" rather than "not measured".
  "confidence" DOUBLE PRECISION,
  "sampleSize" INTEGER,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "domain_os_facts_pkey" PRIMARY KEY ("id")
);

-- The read path's exact lookup, and what makes a write an upsert rather than an append.
CREATE UNIQUE INDEX IF NOT EXISTS "domain_os_facts_domain_kind_level_scopeKey_key"
  ON "domain_os_facts" ("domain", "kind", "level", "scopeKey");

-- Pruning, and answering "is this feed being kept warm at all".
CREATE INDEX IF NOT EXISTS "domain_os_facts_capturedAt_idx"
  ON "domain_os_facts" ("capturedAt");

-- Auditing coverage per domain and level.
CREATE INDEX IF NOT EXISTS "domain_os_facts_domain_level_idx"
  ON "domain_os_facts" ("domain", "level");

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- RETENTION
-- Expired rows are harmless (never served) and merely wasteful. Prune whenever:
--   DELETE FROM "domain_os_facts" WHERE "capturedAt" < NOW() - INTERVAL '7 days';
-- ─────────────────────────────────────────────────────────────────────────────────────────────
