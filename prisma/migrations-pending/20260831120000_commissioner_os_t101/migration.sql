-- Commissioner OS · T-101 — tenant schema, League backfill, tenant-dimension
-- constraints.
--
-- 🛑 NOT APPLIED. This migration has been written and NEVER RUN, against any
-- database. Applying it is a schema change and belongs to the repo owner, not
-- to the author — see CLAUDE.md, "A MIGRATION IS NOT PUSHABLE WORK".
--
-- 🛑 AND IT REFUSES TO RUN BEFORE T-001. The guard at the top of this file
-- raises unless the four database roles exist. That is the handoff's own
-- ordering rule made mechanical rather than advisory: T-102 puts RLS on every
-- table created here, and RLS applied while one role owns the tables AND runs
-- the app does nothing at all — Postgres table owners bypass it. The failure
-- mode is not an error; it is an isolation suite that passes against a control
-- that is not running. If you are deliberately landing the tables ahead of the
-- roles, delete the guard block explicitly rather than working around it.
--
-- WHAT THIS DOES AND DOES NOT COVER
-- T-101 as written in HANDOFF.md has four parts. This migration implements two
-- of them, because the other two have no target in this repo:
--
--   ✅ the tenancy models from prisma/tenancy.prisma
--   ✅ League.tenantId, as a three-step backfill (there is production data)
--   ✅ the TenantWebhook.events GIN index
--   ❌ the User/TenantUser PII split (TENANCY.md §4)
--   ❌ (tenantId, slug) and the RosterSlot open-interval unique
--
-- The last two are not deferred out of caution — they have nothing to act on.
-- This repo has no `User` model (identity is `AppUser`, carrying email,
-- username, displayName, avatarUrl and passwordHash, referenced by ~100
-- relations), no `League.slug`, and no `RosterSlot`. Writing either against a
-- guessed target would produce a migration that looks like compliance and
-- enforces nothing. docs/commissioner-os/SURVEY.md records the full gap list.
--
-- NO RLS HERE — THAT IS T-102, DELIBERATELY
-- tenancy.prisma's header says each model "gets an RLS policy in the
-- accompanying migration", but HANDOFF.md splits T-101 (schema) from T-102
-- (policies + bootstrap functions), and T-102 is where the policies are
-- specified per role. Writing them here would either duplicate T-102 or, worse,
-- ship policies scoped to roles that do not exist yet. The tables land
-- unprotected and T-103's coverage test is what will say so.

-- ---------------------------------------------------------------------------
-- 0 · Ordering guard (see header). Delete deliberately, never route around.
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
      'Commissioner OS T-101 blocked: database roles not provisioned (missing: %). Land T-001 first — see docs/commissioner-os/HANDOFF.md.',
      missing;
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1 · Enums
--
-- LeagueRole is created here despite no column referencing it yet. It is part
-- of the three-axis actor context (T-003/T-104) and lives in tenancy.prisma;
-- creating it now keeps the type and the schema file in step.
-- ---------------------------------------------------------------------------
CREATE TYPE "TenantStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CLOSED');
CREATE TYPE "TenantRole" AS ENUM ('TENANT_OWNER', 'TENANT_ADMIN', 'TENANT_SUPPORT');
CREATE TYPE "PlatformRoleKind" AS ENUM ('PLATFORM_ADMIN', 'PLATFORM_SUPPORT');
CREATE TYPE "LeagueRole" AS ENUM ('COMMISSIONER', 'CO_COMMISSIONER', 'MANAGER');

-- ---------------------------------------------------------------------------
-- 2 · Tenant — the operator
-- ---------------------------------------------------------------------------
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'TRIAL',
    "planKey" TEXT NOT NULL DEFAULT 'trial',
    "maxLeagues" INTEGER,
    "maxSeats" INTEGER,
    "apiRateLimit" INTEGER NOT NULL DEFAULT 60,
    "brandConfig" JSONB,
    "brandVersion" INTEGER NOT NULL DEFAULT 1,
    "region" TEXT NOT NULL DEFAULT 'us-east-1',
    "lastExportAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "deleteReason" TEXT,
    "purgeAfter" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- Globally unique, NOT a partial index — deliberate, and the one uniqueness
-- rule on a soft-deletable model here that is not partial. A slug is burned
-- forever: a closed tenant's identifier must never be reusable by another,
-- because operators hardcode it into API paths and webhook payloads.
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");
CREATE INDEX "Tenant_status_deletedAt_idx" ON "Tenant"("status", "deletedAt");

-- ---------------------------------------------------------------------------
-- 3 · TenantUser — where all PII lives
-- ---------------------------------------------------------------------------
CREATE TABLE "TenantUser" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en-US',
    "timeZone" TEXT NOT NULL DEFAULT 'America/New_York',
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "deleteReason" TEXT,
    "purgeAfter" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantUser_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TenantUser_tenantId_userId_idx" ON "TenantUser"("tenantId", "userId");
CREATE INDEX "TenantUser_tenantId_email_idx" ON "TenantUser"("tenantId", "email");

-- Partial uniques, per invariant 4: a plain @@unique would mean a removed
-- person could never be re-added under the same operator.
CREATE UNIQUE INDEX "TenantUser_tenantId_userId_live_key"
  ON "TenantUser"("tenantId", "userId") WHERE "deletedAt" IS NULL;

-- lower(email): two people cannot hold the same address at one operator under
-- different casing. Case-folded because that is how a login is matched, and a
-- uniqueness rule that disagrees with the lookup is not a uniqueness rule.
CREATE UNIQUE INDEX "TenantUser_tenantId_email_live_key"
  ON "TenantUser"("tenantId", lower("email")) WHERE "deletedAt" IS NULL;

-- ---------------------------------------------------------------------------
-- 4 · TenantMember — the operator's staff
-- ---------------------------------------------------------------------------
CREATE TABLE "TenantMember" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tenantUserId" TEXT NOT NULL,
    "role" "TenantRole" NOT NULL DEFAULT 'TENANT_SUPPORT',
    "externalId" TEXT,
    "invitedBy" TEXT,
    "joinedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "deleteReason" TEXT,
    "purgeAfter" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantMember_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TenantMember_tenantId_tenantUserId_idx" ON "TenantMember"("tenantId", "tenantUserId");
CREATE INDEX "TenantMember_tenantId_externalId_idx" ON "TenantMember"("tenantId", "externalId");

CREATE UNIQUE INDEX "TenantMember_tenantId_tenantUserId_live_key"
  ON "TenantMember"("tenantId", "tenantUserId") WHERE "deletedAt" IS NULL;

-- SCIM assigns externalId; two live members of one tenant sharing one is a
-- provisioning bug that must surface as a write error, not as a duplicate.
CREATE UNIQUE INDEX "TenantMember_tenantId_externalId_live_key"
  ON "TenantMember"("tenantId", "externalId")
  WHERE "deletedAt" IS NULL AND "externalId" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5 · TenantApiKey
-- ---------------------------------------------------------------------------
CREATE TABLE "TenantApiKey" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantApiKey_pkey" PRIMARY KEY ("id")
);

-- ⚠ This unique is only safe because `prefix` carries a RANDOM segment
-- ("cos_live_a1b2c3d4"), not "the first 8 characters of the key" — which for
-- every live key is the constant "cos_live" and would let exactly one key exist
-- in the entire system. T-111's "two keys can coexist" test is the check.
CREATE UNIQUE INDEX "TenantApiKey_prefix_key" ON "TenantApiKey"("prefix");
CREATE INDEX "TenantApiKey_tenantId_revokedAt_idx" ON "TenantApiKey"("tenantId", "revokedAt");

-- ---------------------------------------------------------------------------
-- 6 · TenantWebhook
-- ---------------------------------------------------------------------------
CREATE TABLE "TenantWebhook" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "secretRef" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastFailureAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantWebhook_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TenantWebhook_tenantId_isActive_idx" ON "TenantWebhook"("tenantId", "isActive");

-- The GIN index T-101 calls for. Every dispatch asks "which webhooks want
-- 'draft.completed'" — an array containment query across the whole table, on
-- the hot path of every domain event. Prisma's DSL cannot express this.
CREATE INDEX "TenantWebhook_events_gin_idx" ON "TenantWebhook" USING GIN ("events");

-- ---------------------------------------------------------------------------
-- 7 · PlatformGrant — platform staff, never a column on a user table
-- ---------------------------------------------------------------------------
CREATE TABLE "PlatformGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "PlatformRoleKind" NOT NULL,
    "grantedBy" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,

    CONSTRAINT "PlatformGrant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlatformGrant_userId_revokedAt_idx" ON "PlatformGrant"("userId", "revokedAt");

-- ---------------------------------------------------------------------------
-- 8 · Foreign keys within the tenancy block
-- ---------------------------------------------------------------------------
ALTER TABLE "TenantUser" ADD CONSTRAINT "TenantUser_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TenantMember" ADD CONSTRAINT "TenantMember_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TenantApiKey" ADD CONSTRAINT "TenantApiKey_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TenantWebhook" ADD CONSTRAINT "TenantWebhook_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 9 · League.tenantId — the three-step backfill
--
-- T-000 answer to "is there production data": yes. `leagues` is a live table on
-- a production database shared by preview deployments (see CLAUDE.md on
-- .vercel.app previews using the production DB). So this cannot be one step:
-- ADD COLUMN ... NOT NULL with no default fails outright on a non-empty table,
-- and adding a DEFAULT to get past that would leave the default in place, which
-- is the failure described on the column comment in schema.prisma.
--
-- Steps: nullable column → bootstrap tenant → assign → NOT NULL → FK.
-- ---------------------------------------------------------------------------

-- 9a. Nullable first.
ALTER TABLE "leagues" ADD COLUMN "tenantId" TEXT;

-- 9b. The bootstrap tenant.
--
-- id is the literal 'allfantasy' rather than a cuid, on purpose: four models in
-- this schema already carry `tenantId String @default("allfantasy")`
-- (TradeExecutionSnapshot, DomainEvent, AuditFeedEntry,
-- IntelligenceLeagueSnapshot and its History) from an earlier, FK-less tenancy
-- attempt. Choosing a fresh cuid here would leave those columns pointing at a
-- tenant that does not exist and quietly guarantee two incompatible notions of
-- "tenant" in one database. Matching the existing literal makes them consistent
-- by construction. They are NOT given FKs here — see SURVEY.md.
--
-- ON CONFLICT because a rerun after a partial failure must not abort.
INSERT INTO "Tenant" ("id", "slug", "name", "status", "planKey", "createdAt", "updatedAt")
VALUES ('allfantasy', 'allfantasy', 'AllFantasy', 'ACTIVE', 'internal', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- 9c. Assign every existing league to it.
UPDATE "leagues" SET "tenantId" = 'allfantasy' WHERE "tenantId" IS NULL;

-- 9d. Prove the backfill actually touched the rows before locking it in.
--
-- ⚠ This is not ceremony. Once T-102 puts FORCE ROW LEVEL SECURITY on this
-- table, a backfill running as commish_migrate with app.tenant_id unset and no
-- maintenance policy matches ZERO rows — and the SET NOT NULL below then either
-- fails or, on an empty table, succeeds against data nothing changed. That is
-- the trap named in TENANCY.md §3.2, and a step that cannot fail is how it gets
-- through. Assert the negative instead of assuming it.
DO $backfill$
DECLARE
  unassigned bigint;
BEGIN
  SELECT count(*) INTO unassigned FROM "leagues" WHERE "tenantId" IS NULL;
  IF unassigned > 0 THEN
    RAISE EXCEPTION 'T-101 backfill incomplete: % league rows still have a NULL tenantId', unassigned;
  END IF;
END
$backfill$;

-- 9e. Now it can be required.
ALTER TABLE "leagues" ALTER COLUMN "tenantId" SET NOT NULL;

-- 9f. Index before the FK — the FK's own lookups and every RLS predicate use it.
CREATE INDEX "leagues_tenantId_idx" ON "leagues"("tenantId");
CREATE INDEX "leagues_tenantId_lifecycleState_idx" ON "leagues"("tenantId", "lifecycleState");
CREATE INDEX "leagues_tenantId_season_idx" ON "leagues"("tenantId", "season");
CREATE INDEX "leagues_tenantId_userId_idx" ON "leagues"("tenantId", "userId");

ALTER TABLE "leagues" ADD CONSTRAINT "leagues_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
