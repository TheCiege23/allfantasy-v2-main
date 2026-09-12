-- Commissioner OS · T-007 — append-only AuditEvent.
--
-- 🛑 NOT APPLIED, AND IN `migrations-pending/` RATHER THAN THE DEPLOY PATH.
-- `prisma migrate deploy` reads the DIRECTORY, not git, so anything sitting in
-- prisma/migrations/ is applied by whoever next runs a deploy — regardless of
-- which migration they meant. See prisma/migrations-pending/README.md.
--
-- 🛑 DEPENDS ON T-101. `AuditEvent.tenantRole` uses the `TenantRole` enum and
-- `platformRole` the `PlatformRoleKind` enum, both created by
-- 20260831120000_commissioner_os_t101. Apply that first or this fails on an
-- unknown type. The guard below does not check for it — it checks roles, which
-- is the prerequisite that silently produces a WORKING-BUT-USELESS result
-- rather than an error.
--
-- ⚠ WHY A NEW TABLE INSTEAD OF REUSING WHAT IS HERE.
-- Four audit-ish models already exist. Measured before writing this:
--
--   LeagueAuditLog     onDelete: Cascade to League  → purging a league DELETES
--                      its audit. T-009 requires audit to SURVIVE. Disqualifying.
--                      Actor is an AppUser FK with onDelete: SetNull, so the
--                      trail reads "unknown" once a person is removed. No tenantId.
--   FinanceAuditEvent  same cascade, same SetNull actor, finance-scoped.
--   AuditFeedEntry     a PROJECTION — 3 update/delete call sites, a `summary`
--                      column, keyed on eventId. A read model, not a store.
--   DomainEvent        an event store with a real transactional outbox. NOT
--                      superseded — it is REUSED for step 9. See lib/domain/events.ts.
--
-- LeagueAuditLog was the closest call: it is nearly the right shape and takes
-- ZERO update/delete calls today, so it could have carried the trigger. The
-- cascade is what settles it, and changing that cascade is a schema change to a
-- live AllFantasy table carrying real data.

-- ---------------------------------------------------------------------------
-- 0 · Ordering guard. Same as T-101's, and for the same reason: REVOKE below
--     names commish_app, and a REVOKE from a role that does not exist is an
--     error — but the more dangerous case is the trigger landing while the app
--     still connects as the table owner, where append-only holds only because
--     of the trigger and nobody has checked the REVOKE half at all.
-- ---------------------------------------------------------------------------
DO $guard$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(r, ', ' ORDER BY r) INTO missing
  FROM unnest(ARRAY['commish_migrate', 'commish_app', 'commish_platform', 'commish_purge']) AS r
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'Commissioner OS T-007 blocked: database roles not provisioned (missing: %). Land T-001 first.',
      missing;
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1 · The table
-- ---------------------------------------------------------------------------
CREATE TABLE "AuditEvent" (
    -- INTEGER, not BIGINT. A BigInt does not survive JSON serialization from a
    -- server component to a client one — and it throws in the UI, not here.
    "id" SERIAL NOT NULL,
    "tenantId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    "actorUserId" TEXT NOT NULL,
    -- Denormalised on purpose: the trail must outlive the person.
    "actorLabel" TEXT NOT NULL,
    "platformRole" "PlatformRoleKind",
    "tenantRole" "TenantRole",
    "leagueRole" "LeagueRole",
    "isPlatformRead" BOOLEAN NOT NULL DEFAULT false,

    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    -- 🛑 NO FOREIGN KEY. T-009 requires these rows to survive a league purge,
    -- and a bare column cannot be cascaded away by anything.
    "leagueId" TEXT,
    "onBehalfOfLeagueId" TEXT,

    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,

    "reason" TEXT,
    "requestId" TEXT NOT NULL,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditEvent_tenantId_at_idx" ON "AuditEvent"("tenantId", "at");
CREATE INDEX "AuditEvent_tenantId_resourceType_resourceId_idx" ON "AuditEvent"("tenantId", "resourceType", "resourceId");
CREATE INDEX "AuditEvent_tenantId_actorUserId_at_idx" ON "AuditEvent"("tenantId", "actorUserId", "at");
-- Correlates a request's audit rows with its logs and its domain events.
CREATE INDEX "AuditEvent_requestId_idx" ON "AuditEvent"("requestId");

-- ---------------------------------------------------------------------------
-- 2 · Append-only, enforced TWICE
--
-- 🛑 BOTH HALVES ARE REQUIRED AND NEITHER IS REDUNDANT.
--
-- REVOKE binds `commish_app`. It does NOT bind a table owner, and
-- `commish_migrate` owns this table — so a backfill, a migration, or anything
-- run through DIRECT_URL could rewrite history with the REVOKE in place and no
-- error anywhere.
--
-- The TRIGGER binds everyone including the owner. It is the half that actually
-- makes the guarantee, and T-007's acceptance says so: the test asserts UPDATE
-- and DELETE raise as commish_app AND as commish_migrate, because only the
-- second one distinguishes the trigger from the REVOKE.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION commish_audit_event_append_only()
RETURNS trigger
LANGUAGE plpgsql
-- SET search_path so the function cannot be redirected by a caller's path.
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  RAISE EXCEPTION
    'AuditEvent is append-only: % refused (row id %). Audit records what happened; correcting it means appending, never rewriting.',
    TG_OP, COALESCE(OLD."id"::text, '?')
    USING ERRCODE = 'restrict_violation';
END;
$fn$;

CREATE TRIGGER audit_event_append_only
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW
  EXECUTE FUNCTION commish_audit_event_append_only();

-- ⚠ THE TRIGGER BLOCKS `commish_purge` TOO, AND THAT IS DELIBERATE.
-- T-009 exempts AuditEvent.leagueId from the purge so the rows survive. A
-- retention policy that genuinely must delete old audit rows has to disable
-- this trigger explicitly (ALTER TABLE "AuditEvent" DISABLE TRIGGER
-- audit_event_append_only), which requires the owner and leaves an obvious,
-- reviewable statement behind. That is the intended cost: deleting audit should
-- be a deliberate act someone can point at, never a side effect of a job.

-- ---------------------------------------------------------------------------
-- 3 · Grants
--
-- The app inserts and reads. It cannot update or delete even before the trigger
-- is considered — defence in depth, and the REVOKE is what a `\dp` inspection
-- shows, so the intent is visible without reading trigger source.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT ON "AuditEvent" TO commish_app;
REVOKE UPDATE, DELETE ON "AuditEvent" FROM commish_app;

GRANT USAGE, SELECT ON SEQUENCE "AuditEvent_id_seq" TO commish_app;

-- Platform support reads cross-tenant (T-105), and the rows it produces are
-- marked isPlatformRead so the operator can see them in redacted form.
GRANT SELECT ON "AuditEvent" TO commish_platform;

-- Purge may READ audit (to know what it is purging around) but not delete it.
GRANT SELECT ON "AuditEvent" TO commish_purge;
REVOKE UPDATE, DELETE ON "AuditEvent" FROM commish_purge;
