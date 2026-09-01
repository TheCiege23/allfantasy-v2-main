-- League.lastViewedAt — the demand signal for the historical-refresh rotation.
--
-- 🛑 PARKED IN `migrations-pending/` ON PURPOSE. `prisma migrate deploy` reads the DIRECTORY,
-- not git, so anything sitting in `prisma/migrations/` is applied by whoever next runs it from
-- this shared checkout, regardless of which migration they meant. See the README beside this
-- file. It moves only when the owner has explicitly authorised applying it.
--
-- ── ⚠ THE CODE THAT READS THIS COLUMN CANNOT SHIP BEFORE IT IS APPLIED ──────────────────────
--
-- This is not the usual "code ahead of schema is a bit risky" caution. Prisma's generated client
-- selects every scalar field a model declares unless a query names an explicit `select`. The
-- moment `schema.prisma` carries `lastViewedAt`, EVERY League read without an explicit select
-- issues SQL naming a column production does not have, and Postgres refuses it — P2022.
--
-- There are 827 League reads in this repo. This is therefore an all-or-nothing ordering:
--
--   1. apply THIS migration
--   2. then deploy the code
--
-- Reversing those two takes the product down, not degrades it.
--
-- ── WHY NULLABLE, AND WHY NOT BACKFILLED ────────────────────────────────────────────────────
--
-- Null means "nobody has opened this league since the column existed". That is true, useful, and
-- the rotation is written to expect it.
--
-- Backfilling to `now()` would be the tempting one-liner and it is the single change that would
-- make the whole feature pointless: it would assert that all 199 leagues were viewed at the
-- moment of migration, so demand ordering would rank them identically and silently degrade to
-- arbitrary order — while looking, in the query plan and in the code, exactly like it was
-- working. The starvation floor in the cron, not a fabricated timestamp, is what stops
-- never-viewed leagues waiting forever.
--
-- ── COST ────────────────────────────────────────────────────────────────────────────────────
--
-- `ADD COLUMN` with no default and no NOT NULL is a catalog-only change in Postgres 11+ — no
-- table rewrite, no long lock, safe on a live table.
--
-- ⚠ THE INDEX IS DELIBERATELY *NOT* `CONCURRENTLY`, AND AN EARLIER DRAFT OF THIS COMMENT SAID
-- IT WAS — a comment asserting something the SQL below does not do. Measured before deciding:
-- `leagues` holds 245 rows at 4.3 MB, so a plain `CREATE INDEX` is effectively instantaneous
-- and the brief ACCESS EXCLUSIVE lock is not worth engineering around. `CONCURRENTLY` cannot
-- run inside a transaction, and Prisma Migrate wraps a migration in one — so choosing it here
-- would buy nothing and add a failure mode where `migrate deploy` refuses the file outright.
--
-- If this table is ever large enough for that lock to matter, the index becomes its own
-- migration with `CONCURRENTLY` and no wrapping transaction. It is not that table today.

ALTER TABLE "leagues" ADD COLUMN IF NOT EXISTS "lastViewedAt" TIMESTAMP(3);

-- Partial: rows that have never been viewed are exactly the rows this index is not for, and
-- excluding them keeps it small while the column is mostly null — which is its whole early life.
CREATE INDEX IF NOT EXISTS "leagues_lastViewedAt_idx"
  ON "leagues" ("lastViewedAt" DESC)
  WHERE "lastViewedAt" IS NOT NULL;
