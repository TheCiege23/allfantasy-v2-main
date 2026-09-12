-- Commissioner OS · T-102 — RLS policies and bootstrap functions.
--
-- 🛑 NOT APPLIED. Parked in migrations-pending/. Depends on T-101 (the tables)
--    and T-007 (AuditEvent), both also parked, and on T-001 (the roles).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 🛑 THE MOST IMPORTANT THING IN THIS FILE: `leagues` IS NOT INCLUDED.
--
-- SCOPE.md said "the six tenancy tables + leagues". The second half was wrong,
-- and measuring it is what found that out:
--
--     1,020   AllFantasy call sites reading prisma.league / db.league
--         0   code paths that connect as commish_app
--
-- FORCE ROW LEVEL SECURITY plus policies scoped TO the commish_* roles means a
-- connection as any OTHER role matches no policy, and a table with RLS enabled
-- and no matching policy returns ZERO ROWS. It does not error. So enabling RLS
-- on `leagues` today does not risk an outage — it IS one, silently, across
-- 1,020 call sites, and the symptom is "the app renders as if the database is
-- empty" rather than anything that looks like a permissions failure.
--
-- The prerequisite is not a Commissioner OS decision: either the AllFantasy read
-- path connects as a role that has a policy, or `leagues` gets an explicit
-- legacy policy naming whichever role it uses today. The commented block at the
-- end of this file has the SQL, ready, deliberately inert.
--
-- The same reasoning defers the five pre-existing `tenantId @default
-- ("allfantasy")` tables. `DomainEvent` is the sharpest of them: it is the
-- outbox T-007 writes to, so enabling RLS without a policy for the relay role
-- stops event delivery silently — and a relay finding nothing is
-- indistinguishable from a relay with nothing to do.
--
-- What IS enabled below is the six new tenancy tables plus PlatformGrant.
-- Nothing outside Commissioner OS reads any of them, so this is real isolation
-- at zero blast radius. `lib/domain/tenantScopedTables.ts` is the register, and
-- T-103 will fail on every deferred entry — which is correct: the entry is what
-- makes that failure a known decision rather than a discovery.
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- 0 · Ordering guard
-- ---------------------------------------------------------------------------
DO $guard$
DECLARE missing text;
BEGIN
  SELECT string_agg(r, ', ' ORDER BY r) INTO missing
  FROM unnest(ARRAY['commish_migrate','commish_app','commish_platform','commish_purge']) AS r
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'T-102 blocked: roles not provisioned (missing: %). Land T-001 first.', missing;
  END IF;
END $guard$;

-- ---------------------------------------------------------------------------
-- 1 · Policies on the six tenant-scoped tables
--
-- Three separate grants per table, per TENANCY.md §3.2 — app, maintenance,
-- platform. Written as a loop rather than 18 copy-pasted blocks: hand-copied
-- policies drift, and the drift is invisible because each one still *looks*
-- right on its own.
--
-- ⚠ `nullif(current_setting(...), '')` IS LOAD-BEARING. `set_config` with an
-- empty string does not unset a GUC — it sets it to ''. Without nullif, a
-- reset-to-empty connection would match rows whose tenantId is '' rather than
-- matching nothing.
--
-- ⚠ THE EXPLICIT `WITH CHECK` IS NOT REDUNDANT WITH `USING`. USING filters what
-- you can SEE; WITH CHECK constrains what you can WRITE. Without it, an INSERT
-- carrying another tenant's tenantId succeeds — the row simply becomes
-- invisible to the session that wrote it. That is a cross-tenant write that
-- reports success.
-- ---------------------------------------------------------------------------
DO $policies$
DECLARE
  t text;
  keycol text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Tenant','TenantUser','TenantMember','TenantApiKey','TenantWebhook','AuditEvent']
  LOOP
    -- Tenant has no tenantId; its policy keys on its own primary key (§5).
    keycol := CASE WHEN t = 'Tenant' THEN 'id' ELSE 'tenantId' END;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- FORCE so it applies to the table OWNER too. Without this, commish_migrate
    -- owns these tables and is exempt, and every isolation test would pass
    -- against a control that is not running.
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        FOR ALL TO commish_app
        USING      (%I = nullif(current_setting('app.tenant_id', true), ''))
        WITH CHECK (%I = nullif(current_setting('app.tenant_id', true), ''))
    $f$, t, keycol, keycol);

    -- Migrations, backfills, purge. Without this, T-101's backfill runs as
    -- commish_migrate with app.tenant_id unset, matches ZERO rows, and the
    -- SET NOT NULL that follows either fails or succeeds against unchanged
    -- data — the trap named in TENANCY.md §3.2.
    EXECUTE format($f$
      CREATE POLICY maintenance ON %I
        FOR ALL TO commish_migrate, commish_purge
        USING (true) WITH CHECK (true)
    $f$, t);

    -- Platform support: read-only, cross-tenant, BY ROLE. Never a session
    -- variable — §3.3 is emphatic and it is the single most important decision
    -- in that document.
    EXECUTE format($f$
      CREATE POLICY platform_read ON %I
        FOR SELECT TO commish_platform USING (true)
    $f$, t);
  END LOOP;
END $policies$;

-- ---------------------------------------------------------------------------
-- 2 · AuditEvent's app policy is INSERT + SELECT only
--
-- The generic FOR ALL policy above would permit UPDATE and DELETE as far as RLS
-- is concerned. T-007's REVOKE and trigger stop them anyway — this narrows the
-- policy so all three layers agree, rather than leaving one of them saying
-- something different from the other two.
-- ---------------------------------------------------------------------------
DROP POLICY tenant_isolation ON "AuditEvent";

CREATE POLICY tenant_isolation_read ON "AuditEvent"
  FOR SELECT TO commish_app
  USING ("tenantId" = nullif(current_setting('app.tenant_id', true), ''));

CREATE POLICY tenant_isolation_write ON "AuditEvent"
  FOR INSERT TO commish_app
  WITH CHECK ("tenantId" = nullif(current_setting('app.tenant_id', true), ''));

-- ---------------------------------------------------------------------------
-- 3 · PlatformGrant — not tenant-scoped, still needs RLS
--
-- It has no tenantId because it is not an operator's data. But the default for
-- a table WITHOUT RLS is "every row, to anyone holding SELECT", and this is the
-- table that decides who is a platform admin. commish_app gets NO policy at
-- all: it must not read platform grants directly, and reaches them only through
-- the SECURITY DEFINER bootstrap function below.
-- ---------------------------------------------------------------------------
ALTER TABLE "PlatformGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlatformGrant" FORCE ROW LEVEL SECURITY;

CREATE POLICY maintenance ON "PlatformGrant"
  FOR ALL TO commish_migrate, commish_purge USING (true) WITH CHECK (true);

CREATE POLICY platform_read ON "PlatformGrant"
  FOR SELECT TO commish_platform USING (true);

-- ---------------------------------------------------------------------------
-- 4 · Bootstrap functions — TENANCY.md §3.6
--
-- Lookups that run BEFORE tenantId is known, because they are what DETERMINES
-- it. Under RLS these would return zero rows, and the tempting fix — an ad-hoc
-- bypass — becomes the real hole.
--
-- ⚠ EVERY ONE RETURNS ONLY ENOUGH TO ESTABLISH IDENTITY, NEVER A BUSINESS
-- OBJECT. A SECURITY DEFINER function runs with the owner's rights, so its
-- return type is the size of the hole. Keep this set tiny and review every
-- addition.
--
-- ⚠ `SET search_path` ON EVERY ONE. Without it a caller can put their own
-- schema first and have the function's unqualified names resolve to their
-- objects — the classic SECURITY DEFINER privilege escalation.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app;
GRANT USAGE ON SCHEMA app TO commish_app;

-- Resolve an inbound API key by its prefix (T-111).
CREATE OR REPLACE FUNCTION app.resolve_api_key(p_prefix text)
RETURNS TABLE (tenant_id text, key_id text, hash text, scopes text[])
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT "tenantId", id, hash, scopes
    FROM "TenantApiKey"
   WHERE prefix = p_prefix
     AND "revokedAt" IS NULL
     AND ("expiresAt" IS NULL OR "expiresAt" > now());
$$;

-- Resolve a tenant by the slug in the request path.
-- Returns the id and status only — status because a SUSPENDED tenant must be
-- distinguishable from a missing one at the edge, and nothing else, because
-- name and brandConfig are the operator's data and belong behind withTenant.
CREATE OR REPLACE FUNCTION app.resolve_tenant_by_slug(p_slug text)
RETURNS TABLE (tenant_id text, status "TenantStatus")
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT id, status FROM "Tenant"
   WHERE slug = p_slug AND "deletedAt" IS NULL;
$$;

-- List a user's live tenant memberships at login.
CREATE OR REPLACE FUNCTION app.resolve_user_tenants(p_user_id text)
RETURNS TABLE (tenant_id text, role "TenantRole")
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT m."tenantId", m.role
    FROM "TenantMember" m
    JOIN "TenantUser" u ON u.id = m."tenantUserId" AND u."deletedAt" IS NULL
   WHERE u."userId" = p_user_id AND m."deletedAt" IS NULL;
$$;

-- Whether a user holds a live platform grant. Returns the ROLE, not the row —
-- grantedBy/revokedBy are platform-staff data the app has no business reading.
CREATE OR REPLACE FUNCTION app.resolve_platform_role(p_user_id text)
RETURNS TABLE (role "PlatformRoleKind")
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT role FROM "PlatformGrant"
   WHERE "userId" = p_user_id AND "revokedAt" IS NULL;
$$;

-- EXECUTE is granted narrowly. REVOKE FROM PUBLIC first: functions are
-- executable by PUBLIC by default, which would make every one of these
-- available to any role that can connect.
REVOKE ALL ON FUNCTION app.resolve_api_key(text)        FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_tenant_by_slug(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_user_tenants(text)   FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_platform_role(text)  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.resolve_api_key(text)        TO commish_app;
GRANT EXECUTE ON FUNCTION app.resolve_tenant_by_slug(text) TO commish_app;
GRANT EXECUTE ON FUNCTION app.resolve_user_tenants(text)   TO commish_app;
GRANT EXECUTE ON FUNCTION app.resolve_platform_role(text)  TO commish_app;

-- ---------------------------------------------------------------------------
-- 5 · `leagues` — WRITTEN, DELIBERATELY INERT
--
-- 🛑 DO NOT UNCOMMENT WITHOUT DOING THE PREREQUISITE FIRST.
-- With policies scoped only TO the commish_* roles, all 1,020 AllFantasy call
-- sites that read this table return zero rows. Silently.
--
-- The prerequisite is ONE of:
--   a) the AllFantasy read path connects as a role that has a policy here; or
--   b) a legacy policy is added naming whichever role it uses today.
--
-- (b) is the cheap one and is stubbed below. Fill in the role name — it cannot
-- be hardcoded here because it differs per environment, and guessing it is how
-- this gets applied against a database where it means something else.
--
-- Verify the role first, do not assume:
--     SELECT tableowner FROM pg_tables WHERE tablename = 'leagues';
--     SELECT grantee, privilege_type FROM information_schema.table_privileges
--      WHERE table_name = 'leagues';
--
-- ALTER TABLE "leagues" ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE "leagues" FORCE ROW LEVEL SECURITY;
--
-- CREATE POLICY tenant_isolation ON "leagues"
--   FOR ALL TO commish_app
--   USING      ("tenantId" = nullif(current_setting('app.tenant_id', true), ''))
--   WITH CHECK ("tenantId" = nullif(current_setting('app.tenant_id', true), ''));
--
-- CREATE POLICY maintenance ON "leagues"
--   FOR ALL TO commish_migrate, commish_purge USING (true) WITH CHECK (true);
--
-- CREATE POLICY platform_read ON "leagues"
--   FOR SELECT TO commish_platform USING (true);
--
-- -- The legacy escape. Everything AllFantasy does stays working; only
-- -- commish_app is constrained. Replace <allfantasy_role>.
-- CREATE POLICY legacy_allfantasy ON "leagues"
--   FOR ALL TO <allfantasy_role> USING (true) WITH CHECK (true);
-- ---------------------------------------------------------------------------
