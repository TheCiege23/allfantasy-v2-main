-- Commissioner OS · T-101b — retire the default on leagues.tenantId.
--
-- 🛑 DO NOT APPLY THIS ALONE. IT IS HALF OF A TWO-PART CHANGE AND THE OTHER HALF
-- IS IN `prisma/schema.prisma`.
--
-- Prisma implements a scalar `@default` IN THE DATABASE: the client marks the
-- field optional and OMITS the column on insert, expecting Postgres to fill it.
-- `League.tenantId` now carries `@default("allfantasy")`. So dropping the column
-- default while that line still stands does not make inserts explicit — it makes
-- them fail, with a NOT NULL violation, on league creation and every import
-- path. That is the same outage this default was added to prevent, reached from
-- the opposite direction.
--
-- ⚠ THIS FILE ORIGINALLY SAID SOMETHING WEAKER AND MORE DANGEROUS. It was
-- written when the schema had no `@default` and the column default was a pure
-- deployment-window shim for the then-deployed client; "apply once the new build
-- is serving" was correct advice for that version and is WRONG for this one.
-- Recorded rather than quietly rewritten, because a migration whose stated
-- precondition has silently changed underneath it is exactly the kind of thing
-- someone applies on the strength of a remembered summary.
--
-- ─── THE ORDER, AND ALL THREE PARTS ARE REQUIRED ────────────────────────────
--
--   1. Every prisma.league.create/upsert site passes an explicit tenantId,
--      derived from ActorContext rather than hardcoded to 'allfantasy'.
--      There are 46 today; the ratchet test knows the current set.
--   2. Remove `@default("allfantasy")` from League.tenantId in schema.prisma.
--   3. Apply this migration.
--
-- Doing 3 before 1 and 2 is an outage. Doing 2 before 1 is a runtime
-- PrismaClientValidationError on those same paths — and note `ignoreBuildErrors:
-- true` in next.config.js means the build will not warn you about either.
--
-- ⚠ WHEN THIS ACTUALLY MATTERS: the moment a SECOND real tenant exists. Until
-- then every league legitimately belongs to `allfantasy` and the default is
-- correct, not merely tolerable. After then it is a silent mis-assignment that
-- RLS cannot catch, because the row is legitimately readable by the tenant it
-- landed in. `SELECT count(*) FROM "Tenant" WHERE id <> 'allfantasy'` returning
-- non-zero is the signal to do all three steps.

-- Assert the column is genuinely populated before removing the safety net, so a
-- half-finished backfill cannot be locked in by this step.
DO $check$
DECLARE
  unassigned bigint;
BEGIN
  SELECT count(*) INTO unassigned FROM "leagues" WHERE "tenantId" IS NULL;
  IF unassigned > 0 THEN
    RAISE EXCEPTION
      'T-101b refused: % league rows have a NULL tenantId. Dropping the default now would break inserts.',
      unassigned;
  END IF;
END
$check$;

ALTER TABLE "leagues" ALTER COLUMN "tenantId" DROP DEFAULT;
