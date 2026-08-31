-- Commissioner OS · T-001 — the four database roles.
--
-- 🛑 THIS IS NOT A PRISMA MIGRATION, AND CANNOT BE ONE.
-- Prisma Migrate must itself connect AS `commish_migrate` (TENANCY.md §3.1), so
-- the role has to exist before the first `prisma migrate deploy` runs. A
-- migration that creates the role it runs as is a chicken-and-egg. It also needs
-- CREATE ROLE, which the application's own role must never hold.
--
-- Run it once, by hand, as a role that can create roles — on Neon that is the
-- project owner (`neondb_owner`, a member of `neon_superuser`).
--
--   psql "$DIRECT_URL" \
--     -v app_password="$(openssl rand -base64 24)" \
--     -v platform_password="$(openssl rand -base64 24)" \
--     -v purge_password="$(openssl rand -base64 24)" \
--     -v migrate_password="$(openssl rand -base64 24)" \
--     -f prisma/roles/001_provision_roles.sql
--
-- ⚠ Passwords are psql variables, never literals in this file. This repo is
-- public (see the root CLAUDE.md). Capture the four generated values into your
-- secret store as you run it — they are not recoverable afterwards.
--
-- ⚠ CREATE ROLES WITH THIS SCRIPT, NOT THROUGH THE NEON CONSOLE.
-- Neon adds console-created roles to `neon_superuser`. `commish_app` must not be
-- a member of ANY other role — otherwise it can `SET ROLE` into one that
-- bypasses RLS, and the entire isolation boundary is decorative while every test
-- still passes. This is the concrete instance of the warning in TENANCY.md §3.1
-- ("managed Postgres default roles often carry BYPASSRLS — assert against it
-- rather than assuming"). Do not assume this script got it right either: the
-- T-001 test is what settles it.
--
--   npm run test:commissioner-os
--
-- IDEMPOTENT. Safe to re-run; re-running does not reset passwords.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1 · commish_migrate — owns tables. Prisma Migrate, CI, backfills.
--
-- NOT a superuser and NOT bypassrls. It does not need either: it will OWN the
-- tables, and an owner is exempt from RLS unless the table is FORCE'd — which
-- T-102 does, which is why §3.2 also gives it an explicit `maintenance` policy.
-- Granting BYPASSRLS here would silently make that policy unnecessary, and the
-- day someone removes the policy nothing would fail.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commish_migrate') THEN
    EXECUTE format(
      'CREATE ROLE commish_migrate LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOINHERIT PASSWORD %L',
      :'migrate_password');
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2 · commish_app — the running app. Owns nothing. RLS enforced.
--
-- The single most important role in the system, and the one defined entirely by
-- what it CANNOT do.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commish_app') THEN
    EXECUTE format(
      'CREATE ROLE commish_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOINHERIT PASSWORD %L',
      :'app_password');
  END IF;
END
$$;

-- ⚠ THE ATTRIBUTES ARE INLINE ON `CREATE ROLE` ABOVE, NOT A SEPARATE
-- `ALTER ROLE`. The first version of this script hardened each role with a
-- standalone ALTER, and that FAILED when it was finally run against a copy of
-- the real database — a non-superuser cannot ALTER these attributes, but it can
-- set them at creation time as the creating role. Measured on that copy:
--
--   CREATE ROLE commish_probe LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE
--                             NOCREATEDB NOINHERIT PASSWORD …
--   → rolsuper f, rolbypassrls f, rolcreaterole f, rolcreatedb f, rolinherit f
--
-- Worth knowing: four of the five are already the CREATE ROLE DEFAULTS. Only
-- NOINHERIT differs, and it is the one that matters most here — an inheriting
-- role picks up the privileges of anything it is later granted membership in,
-- without anyone running SET ROLE.

-- ---------------------------------------------------------------------------
-- 3 · commish_platform — cross-tenant READ, platform support path only.
--
-- Reached through its own connection pool (§3.7's third URL). commish_app is
-- deliberately not a member and cannot SET ROLE into it — that is the whole
-- point of §3.3, and it is why cross-tenant access is a role rather than the
-- `app.platform_override` GUC an earlier design used.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commish_platform') THEN
    EXECUTE format(
      'CREATE ROLE commish_platform LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOINHERIT PASSWORD %L',
      :'platform_password');
  END IF;
END
$$;


-- ---------------------------------------------------------------------------
-- 4 · commish_purge — the only role that deletes.
--
-- Invariant 4 says no application code issues DELETE. This is what makes that
-- enforceable rather than aspirational: the app role is not granted DELETE at
-- all (section 5), so a `deleteMany` that slips past the T-005 lint rule fails
-- at the database instead of succeeding quietly.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commish_purge') THEN
    EXECUTE format(
      'CREATE ROLE commish_purge LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOINHERIT PASSWORD %L',
      :'purge_password');
  END IF;
END
$$;


-- ---------------------------------------------------------------------------
-- 5 · Privileges
--
-- Granted on the schema and on DEFAULT PRIVILEGES for objects commish_migrate
-- creates later, so a table added in month eight is covered without anyone
-- remembering to come back here. Existing tables are handled by 002.
--
-- ⚠ DEFAULT PRIVILEGES ARE PER GRANTING ROLE. `FOR ROLE commish_migrate` is
-- load-bearing: a default privilege set up by the current owner does NOT apply
-- to tables commish_migrate creates. Getting this wrong produces a schema where
-- new tables are invisible to the app and old ones are fine — which reads as a
-- migration bug for as long as it takes to look here.
-- ---------------------------------------------------------------------------

-- 🛑 REQUIRED BEFORE `ALTER DEFAULT PRIVILEGES FOR ROLE commish_migrate`.
-- Postgres only lets you set default privileges for a role you are a MEMBER of.
-- Without this the four statements below fail — which is what happened the first
-- time this script met the real database.
--
-- ⚠ NOT AN ESCALATION, and worth being explicit about since it is a GRANT of one
-- role into another in a file whose whole point is that roles stay separate.
-- CURRENT_USER here is the Neon project owner, which already owns every table
-- and can already do anything commish_migrate can. The direction matters:
-- OWNER gains membership in commish_migrate, never the reverse, and
-- `commish_app` gains nothing. T-001's test still asserts commish_app is a
-- member of nothing, and that assertion is untouched by this.
GRANT commish_migrate TO CURRENT_USER;

GRANT USAGE ON SCHEMA public TO commish_app, commish_platform, commish_purge;

-- The app: read and write, never delete. DELETE belongs to commish_purge alone.
ALTER DEFAULT PRIVILEGES FOR ROLE commish_migrate IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO commish_app;
ALTER DEFAULT PRIVILEGES FOR ROLE commish_migrate IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO commish_app;

-- Platform support: read only, and RLS still decides which rows (T-102 gives it
-- a FOR SELECT policy). A SELECT grant is not cross-tenant access on its own.
ALTER DEFAULT PRIVILEGES FOR ROLE commish_migrate IN SCHEMA public
  GRANT SELECT ON TABLES TO commish_platform;

-- Purge: the delete right, plus the reads it needs to find what to delete.
ALTER DEFAULT PRIVILEGES FOR ROLE commish_migrate IN SCHEMA public
  GRANT SELECT, DELETE ON TABLES TO commish_purge;

-- ---------------------------------------------------------------------------
-- 6 · What this script deliberately does NOT do
--
-- No GRANT of any role INTO another. There is no `GRANT commish_platform TO
-- commish_app` here and there must never be one — it would hand the app the
-- cross-tenant read policy through SET ROLE. The T-001 test asserts commish_app
-- is a member of nothing, and that assertion is the reason this comment exists
-- rather than the grant.
--
-- No ownership transfer of EXISTING tables — see 002_transfer_ownership.sql.
-- That is a separate, heavier decision on a populated production database.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 7 · Verify by EFFECT. An empty result here is a FAILURE, not a pass.
--
-- ⚠ `ALTER DEFAULT PRIVILEGES` reports success whether or not it had any effect
-- to record, so the only honest check is to read pg_default_acl back. These are
-- the values measured on a copy of the real database after a successful run:
--
--   tables:    commish_app=arw   commish_platform=r   commish_purge=rd
--   sequences: commish_app=rU
--
--   SELECT defaclobjtype, defaclacl FROM pg_default_acl d
--     JOIN pg_roles r ON r.oid = d.defaclrole
--    WHERE r.rolname = 'commish_migrate';
--
--   SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolinherit
--     FROM pg_roles WHERE rolname LIKE 'commish\_%';
--
-- `npm run test:commissioner-os` asserts both, so this block is for the person
-- running the script by hand rather than a substitute for the test.
-- ---------------------------------------------------------------------------
