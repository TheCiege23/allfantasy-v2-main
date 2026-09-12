-- Commissioner OS · T-201 — LeagueBinding, SyncJob, and their RLS policies.
--
-- 🛑 NOT APPLIED. Parked in migrations-pending/. Depends on T-101 (the tenancy
--    tables and enums), T-102 (the policy shape this copies, and the `app`
--    schema) and T-106 (app.tenant_is_writable, used in the WITH CHECK below).
--
-- ⚠ THE POLICIES ARE IN THIS MIGRATION, NOT DEFERRED TO A LATER ONE.
-- HANDOFF.md T-201: "Both gain tenantId and RLS policies HERE — T-103's
-- coverage test will fail otherwise, which is the point." It DID fail, by name,
-- before the register entry was written:
--
--   Models carry tenantId but are neither RLS-protected nor registered as
--   deferred: LeagueBinding, SyncJob
--
-- That is §3.5 catching a table on the day it is added rather than in month
-- nine, and it is the reason the register and the policies land together.

DO $guard$
DECLARE missing text;
BEGIN
  SELECT string_agg(r, ', ' ORDER BY r) INTO missing
  FROM unnest(ARRAY['commish_migrate','commish_app','commish_platform','commish_purge']) AS r
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'T-201 blocked: roles not provisioned (missing: %). Land T-001 first.', missing;
  END IF;
END $guard$;

-- ---------------------------------------------------------------------------
-- 1 · Types and tables
-- ---------------------------------------------------------------------------
CREATE TYPE "SyncStatus" AS ENUM ('IDLE', 'RUNNING', 'OK', 'DEGRADED', 'FAILED');

CREATE TABLE "LeagueBinding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "externalLeagueId" VARCHAR(128) NOT NULL,
    "externalSeason" VARCHAR(16),
    -- 🛑 A HANDLE INTO A SECRET STORE, NEVER A CREDENTIAL.
    -- A provider token in this column would be readable by every path that can
    -- read a binding, would land in before/after on any audit of a binding
    -- change, and would survive in a tenant export. T-201's acceptance is a
    -- test that no credential material reaches an audit row; storing one here
    -- defeats that at the source rather than at the audit writer.
    "secretRef" TEXT,
    "status" "SyncStatus" NOT NULL DEFAULT 'IDLE',
    -- Opaque, provider-defined. Never parsed by us.
    "cursor" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    -- ⚠ A SUMMARY, NOT THE RAW PROVIDER ERROR. A provider error routinely
    -- embeds the request URL, and the root CLAUDE.md records that Rolling
    -- Insights passes its token as a QUERY PARAMETER — so storing raw errors is
    -- a documented way to get a long-lived credential into a database column
    -- and from there into every log that reads it.
    "lastErrorSummary" VARCHAR(512),
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "deleteReason" TEXT,
    "purgeAfter" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueBinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bindingId" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'IDLE',
    -- Where THIS run got to. Copied onto the binding only on success, so a
    -- failed run cannot advance the binding past data it never reconciled.
    "cursor" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "errorSummary" VARCHAR(512),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LeagueBinding_tenantId_status_idx" ON "LeagueBinding"("tenantId", "status");
CREATE INDEX "LeagueBinding_tenantId_leagueId_idx" ON "LeagueBinding"("tenantId", "leagueId");
CREATE INDEX "LeagueBinding_tenantId_provider_externalLeagueId_idx"
  ON "LeagueBinding"("tenantId", "provider", "externalLeagueId");
CREATE INDEX "SyncJob_tenantId_status_idx" ON "SyncJob"("tenantId", "status");
CREATE INDEX "SyncJob_bindingId_createdAt_idx" ON "SyncJob"("bindingId", "createdAt");

-- One LIVE binding per (tenant, provider, external league).
--
-- PARTIAL, so a disconnected league can be reconnected. A plain unique would
-- make disconnecting permanent — and reconnecting is the ordinary case, not the
-- exception: T-202's acceptance requires it to be idempotent.
CREATE UNIQUE INDEX "LeagueBinding_live_key"
  ON "LeagueBinding"("tenantId", "provider", "externalLeagueId")
  WHERE "deletedAt" IS NULL;

ALTER TABLE "LeagueBinding" ADD CONSTRAINT "LeagueBinding_leagueId_fkey"
  FOREIGN KEY ("leagueId") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_bindingId_fkey"
  FOREIGN KEY ("bindingId") REFERENCES "LeagueBinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ⚠ BOTH CASCADE, WHICH MAKES THEM PURGE-SAFE WITHOUT A NEW BLOCKER.
-- T-009's plan deletes two Restrict relations before deleting a league. These
-- are Cascade, so they ride along with the league delete and add nothing to
-- LEAGUE_PURGE_BLOCKERS — and `purge.spec.ts`'s drift check, which re-derives
-- that list from pg_constraint, will confirm it rather than take my word.

-- ---------------------------------------------------------------------------
-- 2 · RLS — the same three role-scoped grants as T-102
-- ---------------------------------------------------------------------------
DO $policies$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['LeagueBinding','SyncJob']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        FOR ALL TO commish_app
        USING      ("tenantId" = nullif(current_setting('app.tenant_id', true), ''))
        WITH CHECK ("tenantId" = nullif(current_setting('app.tenant_id', true), '')
                    AND app.tenant_is_writable("tenantId"))
    $f$, t);

    EXECUTE format($f$
      CREATE POLICY maintenance ON %I
        FOR ALL TO commish_migrate, commish_purge USING (true) WITH CHECK (true)
    $f$, t);

    EXECUTE format($f$
      CREATE POLICY platform_read ON %I
        FOR SELECT TO commish_platform USING (true)
    $f$, t);
  END LOOP;
END $policies$;

-- ⚠ THE SUSPENSION PREDICATE IS IN THESE FROM THE START, unlike the T-102
-- tables which had it added by T-106. A suspended tenant's integrations must
-- stop WRITING: otherwise a sync job keeps mutating a business that is meant to
-- be read-only, unattended, on a schedule — which is the worst way to find out
-- suspension was not enforced. Reads still work, so the operator can still see
-- and export what is there.
