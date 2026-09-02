-- Rest-of-season projection on AFProjectionSnapshot.
--
-- 🛑 PARKED, NOT APPLIED. `prisma migrate deploy` reads a DIRECTORY rather than git, so anything
-- sitting in prisma/migrations/ rides along on the next person's deploy. This lives in
-- migrations-pending/ until you decide to apply it, and the code that reads these columns must not
-- ship before they exist — a generated client that knows a column production lacks raises P2022.
--
-- ── WHY IT IS NEEDED ────────────────────────────────────────────────────────────────────────
-- `afProjection` is PER GAME. `normalizedPlayerValue` expects a REST-OF-SEASON total. Wiring one
-- to the other without converting understates every player by ~17x, and does it silently:
--
--     elite WR, 19.5/game    raw per-game in -> 532      correctly converted -> 9050
--     RB1,      18.0/game    raw per-game in -> 538      correctly converted -> 9149
--
-- No zero, no NaN, no error. Every wrong value is a plausible mid-tier price, which is why the
-- conversion has to live in ONE place at write time rather than at each read site.
--
-- ── WHY TWO COLUMNS ─────────────────────────────────────────────────────────────────────────
-- `rosWeeksRemaining` is not decoration. Without it a stored ROS total cannot be checked, and a
-- LOW total is indistinguishable from a LATE-SEASON one — a snapshot written in week 3 covers 15
-- weeks, one written in week 14 covers 4, and both are correct. Carrying the divisor makes the
-- number auditable (`rosProjection / rosWeeksRemaining` must reproduce `afProjection`) and lets a
-- reader spot a snapshot whose horizon no longer matches today's week.
--
-- ── COST AND LOCKING ────────────────────────────────────────────────────────────────────────
-- Both columns are NULLABLE WITH NO DEFAULT. In PostgreSQL 11+ that is a catalog-only change: no
-- table rewrite, no backfill, no long lock, regardless of how many rows the table holds. It takes
-- an ACCESS EXCLUSIVE lock only for the moment it updates the catalog.
--
-- ⚠ NULLABLE IS LOAD-BEARING, NOT LAZINESS. Every existing row has no rest-of-season value and
-- must not be given a fabricated one. NULL means "not computed" and the read path must fall back;
-- a DEFAULT 0 would mean "this player is worth nothing", which is a different and much worse claim.
-- There is deliberately NO backfill statement here for the same reason.

-- ⚠ `IF NOT EXISTS` IS DELIBERATE, NOT DEFENSIVE HABIT. These columns were verified present on
-- 2026-09-01 (both nullable, double precision / integer) before this file moved into the deploy
-- path. If they were added by hand rather than through Prisma, `_prisma_migrations` holds no row,
-- and a bare `ADD COLUMN` would fail on the next `migrate deploy` with "column already exists" —
-- which writes a `finished_at IS NULL` row and then blocks EVERY later deploy with P3009. Making
-- the statement idempotent lets Prisma record the migration cleanly whichever way it was applied.
ALTER TABLE "AFProjectionSnapshot"
  ADD COLUMN IF NOT EXISTS "rosProjection"     DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "rosWeeksRemaining" INTEGER;

COMMENT ON COLUMN "AFProjectionSnapshot"."rosProjection" IS
  'Rest-of-season projected points. NULL = not computed; readers must fall back rather than treat as 0. Unit differs from afProjection, which is PER GAME.';

COMMENT ON COLUMN "AFProjectionSnapshot"."rosWeeksRemaining" IS
  'Weeks rosProjection covers, as known at computedAt. Makes the total auditable and distinguishes a low projection from a late-season one.';
