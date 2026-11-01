-- Restore the dispersal draft's five tables, which production is missing (2026-10-31).
--
-- 20260410143800_fix_schema_drift created them, and the ledger records it as applied, but the
-- schema drift check run after the 2026-10-31 production deploy reported all five absent from the
-- live database (no migration on main drops them). #2832 then restored their Prisma models on the
-- assumption the tables existed, so lib/dispersal-draft/DispersalDraftEngine.ts fails on its first
-- write. These are the statements `prisma migrate diff --from-empty` generates for those five models
-- today -- identical to the April migration's -- made idempotent, so the migration is a no-op on any
-- database that still has them: IF NOT EXISTS on every table and index, and each foreign key added
-- only when no constraint of that name exists.


CREATE TABLE IF NOT EXISTS "supplemental_drafts" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "scenario" VARCHAR(32) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'pending',
    "participantRosterIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "passedRosterIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "draftOrder" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "currentPickIndex" INTEGER NOT NULL DEFAULT 0,
    "totalRounds" INTEGER NOT NULL DEFAULT 0,
    "picksPerRound" INTEGER NOT NULL DEFAULT 0,
    "sourceRosterIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assetPool" JSONB NOT NULL DEFAULT '[]',
    "orderMode" VARCHAR(24) NOT NULL DEFAULT 'randomized',
    "draftType" VARCHAR(16) NOT NULL DEFAULT 'linear',
    "pickTimeSeconds" INTEGER NOT NULL DEFAULT 120,
    "autoPickOnTimeout" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplemental_drafts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "supplemental_draft_picks" (
    "id" TEXT NOT NULL,
    "supplementalDraftId" TEXT NOT NULL,
    "pickNumber" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "pickInRound" INTEGER NOT NULL,
    "rosterId" TEXT NOT NULL,
    "assetType" VARCHAR(24),
    "assetId" VARCHAR(128),
    "assetDisplayName" VARCHAR(256),
    "isPassed" BOOLEAN NOT NULL DEFAULT false,
    "isAutoPick" BOOLEAN NOT NULL DEFAULT false,
    "pickedAt" TIMESTAMP(3),

    CONSTRAINT "supplemental_draft_picks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "dispersal_draft_rosters" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT,
    "players" JSONB NOT NULL DEFAULT '[]',
    "draftSlot" INTEGER,
    "isEligible" BOOLEAN NOT NULL DEFAULT true,
    "ineligibilityReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispersal_draft_rosters_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "dispersal_asset_pool" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "playerName" TEXT NOT NULL,
    "playerPosition" TEXT,
    "playerTeam" TEXT,
    "playerAge" INTEGER,
    "sourceRosterId" TEXT,
    "sourcePlatform" TEXT,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "pickedInPickId" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispersal_asset_pool_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "dispersal_draft_participants" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT,
    "teamName" TEXT,
    "draftSlot" INTEGER,
    "isCommissioner" BOOLEAN NOT NULL DEFAULT false,
    "isReady" BOOLEAN NOT NULL DEFAULT false,
    "isOnTheClock" BOOLEAN NOT NULL DEFAULT false,
    "isConnected" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispersal_draft_participants_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "supplemental_drafts_leagueId_status_idx" ON "supplemental_drafts"("leagueId", "status");

CREATE INDEX IF NOT EXISTS "supplemental_draft_picks_draftId_rosterId_idx" ON "supplemental_draft_picks"("supplementalDraftId", "rosterId");

CREATE UNIQUE INDEX IF NOT EXISTS "supplemental_draft_picks_draftId_pickNumber_key" ON "supplemental_draft_picks"("supplementalDraftId", "pickNumber");

CREATE INDEX IF NOT EXISTS "dispersal_draft_rosters_draftId_idx" ON "dispersal_draft_rosters"("draftId");

CREATE UNIQUE INDEX IF NOT EXISTS "dispersal_draft_rosters_draftId_userId_key" ON "dispersal_draft_rosters"("draftId", "userId");

CREATE INDEX IF NOT EXISTS "dispersal_asset_pool_draftId_idx" ON "dispersal_asset_pool"("draftId");

CREATE INDEX IF NOT EXISTS "dispersal_asset_pool_isAvailable_idx" ON "dispersal_asset_pool"("isAvailable");

CREATE UNIQUE INDEX IF NOT EXISTS "dispersal_asset_pool_draftId_playerId_key" ON "dispersal_asset_pool"("draftId", "playerId");

CREATE INDEX IF NOT EXISTS "dispersal_draft_participants_draftId_idx" ON "dispersal_draft_participants"("draftId");

CREATE UNIQUE INDEX IF NOT EXISTS "dispersal_draft_participants_draftId_userId_key" ON "dispersal_draft_participants"("draftId", "userId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplemental_drafts_leagueId_fkey') THEN
    ALTER TABLE "supplemental_drafts" ADD CONSTRAINT "supplemental_drafts_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplemental_drafts_createdByUserId_fkey') THEN
    ALTER TABLE "supplemental_drafts" ADD CONSTRAINT "supplemental_drafts_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplemental_draft_picks_supplementalDraftId_fkey') THEN
    ALTER TABLE "supplemental_draft_picks" ADD CONSTRAINT "supplemental_draft_picks_supplementalDraftId_fkey" FOREIGN KEY ("supplementalDraftId") REFERENCES "supplemental_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dispersal_draft_rosters_draftId_fkey') THEN
    ALTER TABLE "dispersal_draft_rosters" ADD CONSTRAINT "dispersal_draft_rosters_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "supplemental_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dispersal_asset_pool_draftId_fkey') THEN
    ALTER TABLE "dispersal_asset_pool" ADD CONSTRAINT "dispersal_asset_pool_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "supplemental_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dispersal_draft_participants_draftId_fkey') THEN
    ALTER TABLE "dispersal_draft_participants" ADD CONSTRAINT "dispersal_draft_participants_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "supplemental_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
