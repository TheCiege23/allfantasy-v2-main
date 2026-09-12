-- Commissioner OS · T-106 — suspension enforced in the database.
--
-- 🛑 NOT APPLIED. Parked in migrations-pending/. Depends on T-101, T-007, T-102.
--
-- "Read-only is enforced in the RLS WITH CHECK, not in application code — the
-- invariant says the database holds the boundary, and suspension is no
-- exception." (HANDOFF.md, T-106)
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠ THIS CONFLICTS WITH TENANCY.md §5, AND THE CONFLICT IS REAL
--
-- §5: "an RLS policy must be evaluable on its own table without a subquery,
-- and a policy that joins is slow and easy to get wrong."
--
-- Suspension status lives on `Tenant`. Enforcing it in ANY other table's policy
-- therefore requires looking at another table. The two requirements cannot both
-- be met literally, and pretending otherwise would mean either dropping the
-- database enforcement T-106 asks for, or writing a join and not mentioning it.
--
-- The resolution, and why it answers BOTH halves of §5's objection:
--
--   "slow"               — the lookup is a STABLE function taking the tenant id.
--                          Postgres evaluates a STABLE function once per
--                          STATEMENT for a constant argument, not once per row.
--                          And it is in WITH CHECK only, never USING — so READS
--                          pay nothing at all, and writes pay one primary-key
--                          lookup per statement.
--
--   "easy to get wrong"  — one function with one definition, tested once,
--                          rather than the same correlated subquery
--                          copy-pasted into four policies where three of them
--                          drift.
--
-- Recorded as a deliberate, narrow amendment to §5 rather than an oversight.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
DECLARE missing text;
BEGIN
  SELECT string_agg(r, ', ' ORDER BY r) INTO missing
  FROM unnest(ARRAY['commish_migrate','commish_app','commish_platform','commish_purge']) AS r
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'T-106 blocked: roles not provisioned (missing: %). Land T-001 first.', missing;
  END IF;
END $guard$;

-- ---------------------------------------------------------------------------
-- 1 · The writability predicate
--
-- STABLE, not VOLATILE: that is what lets Postgres hoist it out of the per-row
-- loop. It is NOT `IMMUTABLE` — the answer genuinely changes when a tenant is
-- suspended, and marking it immutable would let a plan cache a stale `true`
-- for the length of a session, which is precisely a suspended tenant that can
-- still write.
--
-- SECURITY DEFINER because `commish_app`'s own policy on "Tenant" scopes it to
-- its own row — which is fine here, but would silently return NULL for any
-- future caller checking a different tenant, and NULL is not false.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.tenant_is_writable(p_tenant_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "Tenant"
     WHERE id = p_tenant_id
       AND status <> 'SUSPENDED'
       AND status <> 'CLOSED'
       AND "deletedAt" IS NULL
  );
$$;

REVOKE ALL ON FUNCTION app.tenant_is_writable(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.tenant_is_writable(text) TO commish_app;

-- ⚠ `EXISTS` RATHER THAN A BARE SELECT, SO AN UNKNOWN TENANT IS FALSE.
-- `SELECT status <> 'SUSPENDED' FROM "Tenant" WHERE id = $1` returns NO ROW for
-- a tenant that does not exist, the function returns NULL, and `WITH CHECK
-- (NULL)` is not true but is also not a clean refusal to reason about. EXISTS
-- makes "no such tenant" an unambiguous false.

-- ---------------------------------------------------------------------------
-- 2 · Apply it to the operator's own data
--
-- ALTER POLICY rather than DROP + CREATE: it changes the expression in place,
-- so there is no window during the migration in which the table has no policy —
-- and a table with RLS enabled and no policy returns zero rows to everyone.
-- ---------------------------------------------------------------------------
DO $suspend$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['TenantUser','TenantMember','TenantApiKey','TenantWebhook']
  LOOP
    EXECUTE format($f$
      ALTER POLICY tenant_isolation ON %I
        USING      ("tenantId" = nullif(current_setting('app.tenant_id', true), ''))
        WITH CHECK ("tenantId" = nullif(current_setting('app.tenant_id', true), '')
                    AND app.tenant_is_writable("tenantId"))
    $f$, t);
  END LOOP;
END $suspend$;

-- ---------------------------------------------------------------------------
-- 3 · 🛑 TWO TABLES ARE DELIBERATELY EXCLUDED, AND BOTH WOULD DEADLOCK
--
-- These are not oversights. Each one was going to be included until the
-- consequence was traced.
--
-- "Tenant" ITSELF — otherwise suspension is IRREVERSIBLE.
--   Suspending a tenant sets Tenant.status = 'SUSPENDED'. If Tenant's own
--   WITH CHECK required the tenant to be writable, the row could never be
--   updated again — including by the UPDATE that resumes it. The tenant would
--   be permanently frozen by the act of suspending it, and the only way out
--   would be a manual statement as the table owner.
--
--   So the DATABASE makes the operator's data read-only; the MATRIX decides who
--   may change status (`tenant.suspend` is PLATFORM_ADMIN only, T-104). That is
--   a split between layers, stated openly: T-106 says "not just the service
--   layer", and the data half is genuinely in the database. The status field is
--   platform-managed billing state, and it is authorization that guards it.
--
-- "AuditEvent" — otherwise EXPORT BREAKS, which is T-106's own acceptance.
--   "reads and export still work". `tenant.export` is an audited action, and
--   T-004's wrapper writes the audit row inside the transaction — so if audit
--   writes were blocked for a suspended tenant, every export of a suspended
--   tenant would fail at step 8. A suspended tenant is exactly the tenant most
--   likely to be exporting: they are leaving.
--
--   Audit is append-only anyway (T-007), so leaving it writable adds no ability
--   to change anything. It only preserves the record that something was read.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 4 · Verify by EFFECT, not by the absence of an error
--
--   -- as commish_app, scoped to a SUSPENDED tenant:
--   SELECT count(*) FROM "TenantUser";                    -- rows: reads work
--   INSERT INTO "TenantUser" (...) VALUES (...);          -- must RAISE
--   UPDATE "TenantUser" SET locale = 'x';                 -- must RAISE
--
-- ⚠ AN UPDATE THAT MATCHES ZERO ROWS RAISES NOTHING. WITH CHECK only fires on
-- rows the statement actually touches, so testing suspension with an UPDATE
-- whose WHERE matches nothing reports success and proves the opposite of what
-- it looks like. `constraints.spec.ts` and `suspension.spec.ts` both assert a
-- row is present first.
-- ---------------------------------------------------------------------------
