-- Uniqueness for the three warehouse fact tables, so a re-run stops silently duplicating.
--
-- 🛑 PARKED, NOT APPLIED. Same rule as every file in this directory: `prisma migrate deploy`
-- reads the DIRECTORY, not git. This moves to prisma/migrations/ only when Guap explicitly
-- authorises applying it. Moving it is the deliberate act; writing it is not.
--
-- ── THE DEFECT ────────────────────────────────────────────────────────────────────────────
-- `dw_draft_facts`, `dw_transaction_facts` and `dw_matchup_facts` carry indexes and NO
-- uniqueness, and every backfill writes them as `deleteMany` followed by `create`. Two
-- consequences, both silent:
--   * two concurrent runs for one league interleave and duplicate every row;
--   * a crash between the delete and the insert leaves the league with NOTHING, and the next
--     read reports an empty history rather than an error.
-- `dw_season_standing_facts` already has a natural unique key and uses `upsert`. It is the
-- worked example the other three should match, and the reason this gap is visible at all.
--
-- ── ⚠ THE SCOPE CORRECTION, FOUND WHILE WRITING THIS ──────────────────────────────────────
-- "Add unique keys to the three tables" is NOT achievable as scoped, because two of them have
-- no natural key to put one on. Checked against the writers rather than assumed:
--
--   dw_draft_facts        `SleeperHistoricalDraftSyncService` dedupes IN MEMORY on
--                         (sourceDraftId, season, round, pickNumber, playerId, managerId) and
--                         then STRIPS the draft id before persisting — literally
--                         `const { sourceDraftId: _sourceDraftId, ...persistedRow } = row` —
--                         because the table has no column for it. The database therefore
--                         cannot enforce what the writer already knows.
--
--                         And a key WITHOUT it is actively wrong. A league running a startup
--                         AND a rookie draft in one season has two legitimate rows at the same
--                         (leagueId, season, round, pickNumber); a unique key on those four
--                         would delete real picks during dedupe and call it cleanup.
--
--   dw_transaction_facts  has no source transaction id at all. `NormalizedTransaction` carries
--                         `source_transaction_id` and no writer persists it. Without it there
--                         is no way to distinguish a duplicated row from a manager legitimately
--                         adding the same player twice in different weeks.
--
--   dw_matchup_facts      IS complete. (leagueId, season, weekOrPeriod, teamA, teamB) fully
--                         identifies a pairing. It is the only one constrainable today.
--
-- So this migration adds the missing discriminators FIRST. Adding a unique key without them
-- would either fail on existing duplicates or destroy legitimate rows.
--
-- ── WHY TWO OF THE THREE INDEXES ARE PARTIAL ──────────────────────────────────────────────
-- Every existing row has NULL in the new columns, and they CANNOT be backfilled: the source
-- ids were never stored, so the information does not exist anywhere to recover it from.
--
-- A full unique index would therefore have to treat all those NULLs as equal and dedupe on the
-- remaining columns — which is exactly the "delete real picks" failure above. Instead the draft
-- and transaction indexes are PARTIAL, `WHERE ... IS NOT NULL`:
--   * legacy rows are untouched. No deletion, no dedupe pass, no data loss.
--   * every row written after the writers start populating the id is protected.
--
-- The constraint is therefore INERT until the writer change ships. That is deliberate, and it
-- is the safe order: schema first, writers second, legacy cleanup third as its own decision
-- made against real data rather than bundled into a migration nobody can review against it.
--
-- ── WHAT THIS CHANGES FOR THE WRITERS (required follow-up, NOT in this file) ───────────────
-- Once applied and once the ids are populated, a delete-then-insert that races raises a unique
-- violation instead of duplicating quietly. That is the improvement — a loud failure beats a
-- silent one — but the writers should then move to `upsert` on these keys the way
-- `dw_season_standing_facts` already does. Applying this alone makes concurrency FAIL rather
-- than corrupt; it does not by itself make concurrency SUCCEED.
--
-- ── ⚠ NOT CONCURRENTLY, AND SAYING SO PLAINLY ─────────────────────────────────────────────
-- `CREATE INDEX CONCURRENTLY` cannot run inside a transaction and Prisma wraps a migration in
-- one. These are plain `CREATE UNIQUE INDEX`, which takes a brief ACCESS EXCLUSIVE lock on each
-- table. Acceptable here — these are warehouse tables read by analytics, not on a request path
-- — but it is a real lock and this comment does not pretend otherwise. This repo has already
-- shipped a migration whose comment claimed CONCURRENTLY while the SQL did not; not repeated.
--
-- ── ⚠ RUN THIS BEFORE APPLYING, so the DELETE below is a known quantity, not a surprise ────
-- The only statement here that removes data is the `dw_matchup_facts` dedupe. Count first:
--
--   SELECT count(*) - count(DISTINCT ("leagueId", COALESCE("season", -1),
--                                     "weekOrPeriod", "teamA", "teamB"))
--     AS rows_the_migration_will_delete
--   FROM "dw_matchup_facts";
--
-- Zero means the dedupe is a no-op and this migration only adds columns and indexes. A large
-- number means duplication has already happened and is worth understanding before it is tidied
-- away — that count IS the evidence for the defect this migration exists to stop.
--
-- ── SAFETY ────────────────────────────────────────────────────────────────────────────────
-- Every statement is `IF NOT EXISTS`, so a re-run is a no-op that succeeds rather than a
-- failure that writes `finished_at IS NULL` into `_prisma_migrations` and blocks every later
-- migration with P3009 until someone resolves it by hand.
--
-- ⚠ AND schema.prisma IS DELIBERATELY NOT UPDATED IN THIS CHANGE. Adding these columns there
-- makes the generated client include them in its DEFAULT SELECT for every read of those
-- models; against a production database that lacks them, that is P2022 on `findMany` — not
-- confined to code that wants the new fields. The order is: apply this, THEN update
-- schema.prisma, THEN ship writers. Never the reverse.

-- ── 1. The missing discriminators ─────────────────────────────────────────────────────────

ALTER TABLE "dw_draft_facts"
  ADD COLUMN IF NOT EXISTS "sourceDraftId" VARCHAR(64);

ALTER TABLE "dw_transaction_facts"
  ADD COLUMN IF NOT EXISTS "sourceTransactionId" VARCHAR(128);

-- ── 2. dw_matchup_facts — the one with a complete natural key ─────────────────────────────
--
-- Deduplicate BEFORE indexing, or the CREATE fails on the existing duplicates.
--
-- Keeps exactly one row per key: the greatest by (createdAt, matchupId). The tie-break on the
-- primary key makes it deterministic when two rows share a timestamp, which they will — a
-- duplicated batch is written inside one transaction. A row is deleted only when a strictly
-- greater sibling exists on the same key, so a table with no duplicates loses nothing.
--
-- `season` is nullable and NULLs never compare equal, so a bare column list would leave legacy
-- null-season rows both unmatched by this delete and unconstrained by the index. COALESCE to a
-- sentinel no real season can take makes both cover them.

DELETE FROM "dw_matchup_facts" a
USING "dw_matchup_facts" b
WHERE a."leagueId" = b."leagueId"
  AND COALESCE(a."season", -1) = COALESCE(b."season", -1)
  AND a."weekOrPeriod" = b."weekOrPeriod"
  AND a."teamA" = b."teamA"
  AND a."teamB" = b."teamB"
  AND (a."createdAt", a."matchupId") < (b."createdAt", b."matchupId");

CREATE UNIQUE INDEX IF NOT EXISTS "dw_matchup_facts_natural_key"
  ON "dw_matchup_facts" (
    "leagueId", (COALESCE("season", -1)), "weekOrPeriod", "teamA", "teamB"
  );

-- ── 3. dw_draft_facts — partial, on the new discriminator ─────────────────────────────────
--
-- playerId and managerId are in the key because the writer's own in-memory dedupe includes
-- them. Two rows at the same (draft, round, pick) with different players is a real thing during
-- a provider correction; collapsing those would lose a pick rather than a duplicate.

CREATE UNIQUE INDEX IF NOT EXISTS "dw_draft_facts_source_pick_key"
  ON "dw_draft_facts" (
    "leagueId", "sourceDraftId", "round", "pickNumber", "playerId", (COALESCE("managerId", ''))
  )
  WHERE "sourceDraftId" IS NOT NULL;

-- ── 4. dw_transaction_facts — partial, on the new discriminator ───────────────────────────
--
-- One provider transaction produces one row PER PLAYER — a three-player trade is three rows —
-- so playerId is part of the identity, not evidence of duplication. `type` is included because
-- a single transaction can both add and drop, and those are distinct facts about it.

CREATE UNIQUE INDEX IF NOT EXISTS "dw_transaction_facts_source_key"
  ON "dw_transaction_facts" (
    "leagueId", "sourceTransactionId", "type", (COALESCE("playerId", ''))
  )
  WHERE "sourceTransactionId" IS NOT NULL;
