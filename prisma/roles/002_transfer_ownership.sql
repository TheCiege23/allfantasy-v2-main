-- Commissioner OS · T-001 (second half) — make commish_migrate the table owner.
--
-- 🛑 READ THIS BEFORE RUNNING IT. This is the heaviest operation in T-001 and
-- the only one that touches 710 existing tables on a live database. It is in its
-- own file, not appended to 001, so that provisioning the roles does not
-- implicitly reassign a production schema.
--
-- WHY IT IS NEEDED
-- TENANCY.md §3.1: "Prisma Migrate creates tables as whoever is in DATABASE_URL.
-- If app and migrations share a role, that role owns every table, RLS silently
-- does nothing, and isolation tests pass against a control that isn't running."
--
-- On THIS database the tables are already owned by the Neon project owner
-- (`neondb_owner`), which is not commish_app — so the specific disaster above is
-- not the current state. What is true is that T-102's `FORCE ROW LEVEL SECURITY`
-- and its `maintenance` policy are written for an owner named commish_migrate.
-- Leaving ownership on neondb_owner means the maintenance policy names a role
-- that never runs migrations, and backfills go on working for the wrong reason
-- (owner bypass) rather than the right one (the policy).
--
-- WHAT IT COSTS
-- `REASSIGN OWNED` takes an ACCESS EXCLUSIVE lock on every object it moves. On
-- 710 tables against live traffic that is a maintenance window, not a deploy
-- step. It is also not something to run while another session holds a long
-- transaction — it will queue behind it and block everything arriving after.
--
-- WHAT IT DOES NOT DO
-- It does not move ownership of the DATABASE, of extensions, or of anything
-- outside `public`. And it is NOT reversible by re-running with the arguments
-- swapped: neondb_owner is a Neon-managed role and reassigning back to it has
-- not been tested here. Take a branch first — on Neon that is cheap and is the
-- entire reason to use one.
--
-- 🛑 DO NOT RUN THIS AGAINST PRODUCTION TO "SEE WHAT HAPPENS". Neon preview
-- branches share the production database on this project (root CLAUDE.md
-- documents the incident); create an actual Neon branch and point DIRECT_URL at
-- it first. `npx tsx scripts/check-staging-env.ts` is the check that settles
-- which database you are on — the hostname is not.
--
--   psql "$DIRECT_URL" -f prisma/roles/002_transfer_ownership.sql
--
-- Run as the CURRENT owner (neondb_owner). REASSIGN OWNED can only be run by a
-- role that is a member of both the source and target roles.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Preflight: name the current owner out loud rather than assuming it.
--
-- If this reports more than one owning role, STOP — a split-ownership schema
-- means some tables would move and some would not, and a partial reassignment
-- is worse than none: T-102's maintenance policy would cover exactly the ones
-- that moved, and nothing would say which.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  owners text;
  n int;
BEGIN
  SELECT string_agg(DISTINCT tableowner, ', '), count(DISTINCT tableowner)
    INTO owners, n
  FROM pg_tables WHERE schemaname = 'public';

  RAISE NOTICE 'public schema tables are owned by: % (% distinct role(s))', owners, n;

  IF n > 1 THEN
    RAISE EXCEPTION
      'Split ownership detected (%). Reassigning would move only some tables; resolve by hand first.',
      owners;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- The reassignment.
--
-- REASSIGN OWNED rather than a generated loop of ALTER TABLE ... OWNER TO: it
-- covers tables, sequences, views, functions and types in one statement, and
-- it cannot miss one. A loop over pg_tables would silently leave the enum types
-- created by the T-101 migration behind.
--
-- ⚠ Uncomment deliberately. It is commented out so that running this file by
-- accident is a no-op that prints the current owner and stops.
-- ---------------------------------------------------------------------------

-- REASSIGN OWNED BY neondb_owner TO commish_migrate;

-- ---------------------------------------------------------------------------
-- After reassignment, the grants in 001 cover only FUTURE tables (they are
-- DEFAULT PRIVILEGES). Existing ones need the same grants applied once.
--
-- ⚠ Uncomment together with the REASSIGN above — granting to the app role while
-- the tables still belong to neondb_owner is harmless but pointless, and leaves
-- a half-applied state that looks finished.
-- ---------------------------------------------------------------------------

-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES    IN SCHEMA public TO commish_app;
-- GRANT USAGE, SELECT           ON ALL SEQUENCES IN SCHEMA public TO commish_app;
-- GRANT SELECT                  ON ALL TABLES    IN SCHEMA public TO commish_platform;
-- GRANT SELECT, DELETE          ON ALL TABLES    IN SCHEMA public TO commish_purge;

-- ---------------------------------------------------------------------------
-- 🛑 RE-ASSERT THE AUDIT REVOKES. `ON ALL TABLES` MEANS ALL TABLES, INCLUDING
-- THE ONE THAT IS SUPPOSED TO BE APPEND-ONLY.
--
-- The four grants above are blanket. T-007 ends with two targeted REVOKEs that
-- make `AuditEvent` append-only at the privilege layer:
--
--     REVOKE UPDATE, DELETE ON "AuditEvent" FROM commish_app;
--     REVOKE UPDATE, DELETE ON "AuditEvent" FROM commish_purge;
--
-- Running this file AFTER T-007 silently undoes both. Measured on a Neon branch,
-- 2026-08-31, immediately after the grants above:
--
--     has_table_privilege('commish_app',  '"AuditEvent"','UPDATE') → true
--     has_table_privilege('commish_purge','"AuditEvent"','DELETE') → true
--
-- ⚠ NOTHING FAILS WHEN THIS HAPPENS, AND THAT IS THE PROBLEM. In the documented
-- order (001 → 002 → migrate deploy) T-007 runs last and re-applies its own
-- REVOKEs, so the hole never appears. But 002 is re-runnable and looks harmless,
-- and any order that puts it after the migrations reopens both privileges with
-- no error, no warning and no failing test.
--
-- ⚠ THE APPEND-ONLY TRIGGER STILL HELD WHEN THIS WAS FOUND, WHICH IS WHY IT WAS
-- NEARLY MISSED. A tamper attempt as commish_app reported success and changed
-- nothing — but only because RLS gives commish_app no UPDATE policy on
-- AuditEvent, so the statement matched zero rows and the trigger never ran. Two
-- unrelated defences happened to cover for the missing third. Verified the
-- trigger does fire when a row IS matched:
--
--     ERROR: AuditEvent is append-only: UPDATE refused (row id 1).
--
-- Re-asserting here makes the file order-independent rather than relying on it.
-- ---------------------------------------------------------------------------

-- REVOKE UPDATE, DELETE ON "AuditEvent" FROM commish_app;
-- REVOKE UPDATE, DELETE ON "AuditEvent" FROM commish_purge;

-- ---------------------------------------------------------------------------
-- Verify by effect, not by the absence of an error:
--
--   SELECT tableowner, count(*) FROM pg_tables
--    WHERE schemaname='public' GROUP BY 1;
--
-- then re-run `npm run test:commissioner-os`, which asserts commish_app owns
-- nothing. A reassignment that silently did nothing looks identical to one that
-- worked, right up until T-102's isolation suite passes against a control that
-- is not running.
-- ---------------------------------------------------------------------------
