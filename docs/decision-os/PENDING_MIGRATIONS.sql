-- ══════════════════════════════════════════════════════════════════════════════════════════
-- ✅ RESOLVED 2026-08-31 — BOTH WERE ALREADY APPLIED. NOTHING BELOW NEEDS RUNNING.
--
-- STEP 0 was run against production (neondb) and returned `t` for all three:
--
--     A: FantraxLeague.sourceLeagueId column       t
--     A: FantraxLeague_sourceLeagueId_idx index    t
--     B: tournament_shell_grants table             t
--
-- The `_prisma_migrations` query returned TWO rows, so both are recorded as applied by Prisma
-- Migrate rather than pasted in as raw DDL — which means the bookkeeping in STEP 2 is already
-- correct and must NOT be re-done.
--
-- ⚠ THERE WAS NEVER A P2022 EXPOSURE. The reasoning that predicted one was sound about the
-- REPO and wrong about PRODUCTION, and the difference is the caveat this file already carried:
--
--   package.json      `build:vercel` (the only script chaining db:migrate:deploy) is referenced
--                     nowhere but its own definition. `vercel-build`, which Vercel actually
--                     resolves, has zero `prisma migrate` references.
--   .github/          the one `npx prisma migrate deploy` is COMMENTED OUT
--                     (neon-pr-branches.yml:66).
--   production        both applied, both recorded.
--
-- 🛑 SO A MECHANISM EXISTS THAT THE REPO DOES NOT SHOW. The likeliest is a Build Command
-- override set in the Vercel dashboard, which beats both npm hooks and which
-- docs/release-readiness/PHASE_0_RELEASE_BASELINE.md already flags as unconfirmed: "confirm
-- Vercel build command = vercel-build". A manual run is the other candidate.
--
-- ⚠ THE LESSON IS NOT "THE ANALYSIS WAS WRONG" — it is that "no deploy applies migrations"
-- is a belief about a system nobody has checked, and it is load-bearing in BOTH directions.
-- Believe it and you hand-apply things that were already applied. Disbelieve it and you park a
-- migration in prisma/migrations/ expecting it to sit there. Which is exactly what happened:
--
--
-- ═══ THE REAL FINDING: A MIGRATION MARKED "PARKED, NOT APPLIED" IS APPLIED ════════════
--
-- 20260831_tournament_grants opens with "🛑 PARKED, NOT APPLIED ... This lives in
-- migrations-pending/ until the user decides to apply it." It does not live there — it is in
-- prisma/migrations/ — and production has the table. The parking failed silently and the file
-- still asserts otherwise.
--
-- ⚠ AND IT LEFT DRIFT THAT THIS REPO'S OWN CHECKER CANNOT SEE. `tournament_shell_grants`
-- exists in the database; `TournamentShellGrant` is in NEITHER origin/main's schema.prisma nor
-- the working tree's. lib/prisma/schema-drift.ts only detects the opposite direction — P2022,
-- "the schema has something the database lacks". A table the database has and the schema does
-- not is invisible to it.
--
-- 🛑 THE FOOTGUN: the migration is in the history AND applied, while schema.prisma has no
-- model for it. `prisma migrate dev` replays the history in the shadow database, diffs against
-- schema.prisma, and proposes DROP TABLE "tournament_shell_grants" — as a normal, expected
-- migration. Whoever runs it next has to notice and refuse.
--
-- The fix belongs to the tournament author, who knows the intended shape: either add the
-- TournamentShellGrant model to schema.prisma so the schema matches what production has, or
-- decide the feature is off and drop the table AND the migration together. Guessing the model
-- here would be worse than leaving it named.
-- ══════════════════════════════════════════════════════════════════════════════════════════
--
-- Everything below is kept as the record of what was checked and how. STEP 0 remains useful —
-- it is read-only and re-runnable, and it is what settled this.
--
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- TWO MIGRATIONS ARE ON `main` AND NOTHING APPLIES THEM. Prepared 2026-08-31.
--
-- Run STEP 0 first. It writes nothing and tells you whether either of these is already done.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- WHY THEY ARE PENDING AT ALL: no deploy applies migrations here.
--
--   vercel.json sets no buildCommand, so Vercel resolves the `vercel-build` npm hook
--   vercel-build  -> node scripts/vercel-next-build.cjs        0 `prisma migrate` references
--   build:vercel  -> db:migrate:deploy && vercel-build         referenced NOWHERE in the repo
--
-- ⚠ ONE THING NOT CHECKABLE FROM THE REPO: a Build Command override set in the Vercel
-- dashboard takes precedence over both. Treat "no deploy applies these" as verified on the
-- repo and UNVERIFIED on the dashboard — which is another reason to run STEP 0 first.
--
--
-- ── THE TWO ARE NOT EQUALLY URGENT ─────────────────────────────────────────────────────────
--
-- A · FantraxLeague.sourceLeagueId    LIVE EXPOSURE. Apply this one.
--
--     The column is declared in `prisma/schema.prisma` on main, so the generated client
--     believes it exists. And it is queried by shipped code:
--
--       lib/fantasy-os/sync/collector/fantraxMatchupParity.ts
--         enumerateFantraxMatchupConnections()
--           prisma.fantraxLeague.findMany({
--             where:  { sourceLeagueId: { not: null } },
--             select: { id, sourceLeagueId, season, leagueName },
--           })
--
--     reached from app/api/cron/fantasy-os-exec-sync/route.ts:147 via runFantraxMatchupParity,
--     and that cron is scheduled `*/30 * * * *`.
--
--     🛑 If the column is absent in production, that query raises P2022 every thirty minutes.
--     P2022 does NOT degrade quietly — Prisma raises rather than returning empty.
--
-- B · tournament_shell_grants          NOT NEEDED YET. Your call, no rush.
--
--     Zero code reads it. `TournamentShellGrant` is not in prisma/schema.prisma on main, so
--     the generated client does not know the table exists and nothing can query it. Applying
--     it early creates an unused table — harmless, but it buys nothing today.
--
--     ⚠ AND ITS OWN HEADER IS WRONG ABOUT WHERE IT LIVES. It says "This lives in
--     migrations-pending/ until the user decides to apply it". It does not — it is in
--     prisma/migrations/, on main. prisma/migrations-pending/ exists and holds eight
--     commissioner-os migrations, so the convention is real and this file missed it.
--     The consequence: `prisma migrate deploy` reads a DIRECTORY, not git, so anyone who
--     runs it applies B along with A whether they meant to or not.


-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- STEP 0 — READ ONLY. Writes nothing. Run this first and read the three rows.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

SELECT
  'A: FantraxLeague.sourceLeagueId column' AS what,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'FantraxLeague' AND column_name = 'sourceLeagueId'
  ) AS present
UNION ALL
SELECT
  'A: FantraxLeague_sourceLeagueId_idx index',
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'FantraxLeague_sourceLeagueId_idx')
UNION ALL
SELECT
  'B: tournament_shell_grants table',
  EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'tournament_shell_grants'
  );

-- What Prisma believes it has already applied. If this errors with "relation does not exist",
-- Prisma Migrate has never run against this database and you want the manual path below.
SELECT migration_name, finished_at, rolled_back_at
FROM   _prisma_migrations
WHERE  migration_name IN ('20260830160000_fantrax_league_source_id', '20260831_tournament_grants')
ORDER  BY migration_name;

-- How many rows the index will have to build over. Small = the plain CREATE INDEX below is fine.
SELECT count(*) AS fantrax_rows FROM "FantraxLeague";


-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- STEP 1 — A, the one that matters. Idempotent: safe to run twice.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- ADD COLUMN with no DEFAULT and no NOT NULL is a catalog-only change in Postgres 11+ —
-- no table rewrite, and the lock is held for microseconds.
--
-- NULLABLE PERMANENTLY, not pending a backfill. Fantrax was a CSV upload before it was an API
-- client, and a CSV-era row was never given a league id by anyone — there is nothing to backfill
-- FROM. NULL here means "snapshot only, not refreshable", which is why the enumerator filters
-- `{ not: null }` rather than treating a null as an error.
--
-- NOT UNIQUE, deliberately. The row key is (userId, leagueName, season), so two AllFantasy
-- accounts importing the same Fantrax league correctly produce two rows carrying the same source
-- id. A UNIQUE constraint would turn the second person's import into a write error.

ALTER TABLE "FantraxLeague" ADD COLUMN IF NOT EXISTS "sourceLeagueId" TEXT;

CREATE INDEX IF NOT EXISTS "FantraxLeague_sourceLeagueId_idx"
  ON "FantraxLeague"("sourceLeagueId");

-- ⚠ If STEP 0 reported a large row count, use this instead of the CREATE INDEX above — it does
-- not take a write lock. It CANNOT run inside a transaction, so send it on its own:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "FantraxLeague_sourceLeagueId_idx"
--     ON "FantraxLeague"("sourceLeagueId");


-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- STEP 2 — TELL PRISMA IT IS DONE. Do not skip this.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- 🛑 RAW DDL LEAVES `_prisma_migrations` UNTOUCHED, so the next `prisma migrate deploy` tries to
-- apply STEP 1 again and fails on "column already exists" — with the schema actually correct.
-- That failure is confusing precisely because nothing is wrong.
--
-- PREFERRED, because it computes the checksum from the file rather than trusting a paste:
--
--   npx prisma migrate resolve --applied 20260830160000_fantrax_league_source_id
--
-- Only if that is not available, insert the record by hand. The checksum is the SHA-256 of the
-- migration.sql bytes and Prisma VERIFIES it on every later deploy — a wrong one produces a
-- checksum-mismatch error that is harder to diagnose than the problem it was meant to avoid.

-- INSERT INTO _prisma_migrations
--   (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
-- VALUES
--   (gen_random_uuid()::text,
--    '462443d0d19434d5bfea375204226254b597deb87d94336c505c2d673408d0cc',
--    now(), '20260830160000_fantrax_league_source_id', NULL, NULL, now(), 1);


-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- STEP 3 — B, tournament_shell_grants. OPTIONAL. Nothing reads it yet.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- Apply only if you want the table to exist ahead of the code. It is additive and touches
-- nothing that runs today.

-- CREATE TABLE IF NOT EXISTS "tournament_shell_grants" (
--     "id"              TEXT        NOT NULL,
--     "tournamentId"    TEXT        NOT NULL,
--     -- The AppUser being granted access. A manager with no AllFantasy login cannot be granted
--     -- permissions here: a grant needs an account to point at.
--     "userId"          TEXT        NOT NULL,
--     -- Human label only. The booleans below are what is enforced, so a role that drifts from
--     -- them cannot silently widen anyone's access.
--     "role"            VARCHAR(32) NOT NULL DEFAULT 'viewer',
--     -- Every grant includes READ. These three are additive on top and each defaults FALSE:
--     -- a co-commissioner has access but changes nothing until it is given explicitly.
--     "canBroadcast"    BOOLEAN     NOT NULL DEFAULT false,
--     "canAdvance"      BOOLEAN     NOT NULL DEFAULT false,
--     "canEditSettings" BOOLEAN     NOT NULL DEFAULT false,
--     "grantedByUserId" TEXT        NOT NULL,
--     "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
--     "updatedAt"       TIMESTAMP(3) NOT NULL,
--     CONSTRAINT "tournament_shell_grants_pkey" PRIMARY KEY ("id")
-- );
--
-- -- One grant per person per tournament: two rows would make "what can they do" depend on
-- -- which was read first.
-- CREATE UNIQUE INDEX IF NOT EXISTS "tournament_shell_grants_tournamentId_userId_key"
--     ON "tournament_shell_grants"("tournamentId", "userId");
-- CREATE INDEX IF NOT EXISTS "tournament_shell_grants_tournamentId_idx"
--     ON "tournament_shell_grants"("tournamentId");
-- -- Listing "tournaments I can see" is a per-user read.
-- CREATE INDEX IF NOT EXISTS "tournament_shell_grants_userId_idx"
--     ON "tournament_shell_grants"("userId");
--
-- -- Cascade: a deleted tournament must not leave grants pointing at nothing.
-- ALTER TABLE "tournament_shell_grants"
--     ADD CONSTRAINT "tournament_shell_grants_tournamentId_fkey"
--     FOREIGN KEY ("tournamentId") REFERENCES "tournament_shells"("id")
--     ON DELETE CASCADE ON UPDATE CASCADE;
--
-- Then:  npx prisma migrate resolve --applied 20260831_tournament_grants
-- checksum, if inserting by hand:
--   6cab69810bfac0e69202a81494b9b76cea84c82edcd344ec6f618fcfc91870e6


-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- STEP 4 — VERIFY. Re-run STEP 0. `present` must now be true for the two A rows.
--
-- ⚠ And confirm the symptom is gone rather than assuming: the exec-sync cron runs every 30
-- minutes, so within one cycle the Fantrax parity step should stop raising P2022.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
