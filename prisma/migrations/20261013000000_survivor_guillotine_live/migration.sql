CREATE TABLE IF NOT EXISTS "survivor_guillotine_leagues" (
  "id" TEXT PRIMARY KEY,
  "leagueId" TEXT NOT NULL UNIQUE REFERENCES "leagues"("id") ON DELETE CASCADE,
  "config" JSONB NOT NULL,
  "tribes" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "tribeDraftState" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "periodState" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "scoreHistory" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "periodHistory" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "rewardPeriods" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "periodCalendar" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "captainElectionDeadlineAt" TIMESTAMP(3),
  "currentPeriod" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'setup',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "lastCorrectionCheckAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "survivor_guillotine_powers" (
  "id" TEXT PRIMARY KEY,
  "leagueId" TEXT NOT NULL REFERENCES "leagues"("id") ON DELETE CASCADE,
  "kind" TEXT NOT NULL,
  "binding" TEXT NOT NULL,
  "playerId" TEXT,
  "ownerUserId" TEXT,
  "awardPeriod" INTEGER,
  "activationPeriod" INTEGER,
  "expiresAfterPeriod" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'held',
  "source" TEXT NOT NULL DEFAULT 'draft',
  "targetRosterId" TEXT,
  "revealedAt" TIMESTAMP(3),
  "activatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "survivor_guillotine_powers_leagueId_ownerUserId_status_idx" ON "survivor_guillotine_powers"("leagueId", "ownerUserId", "status");
CREATE INDEX IF NOT EXISTS "survivor_guillotine_powers_leagueId_playerId_status_idx" ON "survivor_guillotine_powers"("leagueId", "playerId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "survivor_guillotine_powers_leagueId_awardPeriod_key" ON "survivor_guillotine_powers"("leagueId", "awardPeriod");

CREATE TABLE IF NOT EXISTS "survivor_guillotine_captain_votes" (
  "id" TEXT PRIMARY KEY,
  "leagueId" TEXT NOT NULL REFERENCES "leagues"("id") ON DELETE CASCADE,
  "period" INTEGER NOT NULL,
  "tribeId" TEXT NOT NULL,
  "voterRosterId" TEXT NOT NULL,
  "candidateRosterId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "survivor_guillotine_captain_votes_leagueId_period_voterRosterId_key" UNIQUE ("leagueId", "period", "voterRosterId")
);
CREATE INDEX IF NOT EXISTS "survivor_guillotine_captain_votes_leagueId_period_tribeId_idx" ON "survivor_guillotine_captain_votes"("leagueId", "period", "tribeId");

CREATE TABLE IF NOT EXISTS "survivor_guillotine_choice_votes" (
  "id" TEXT PRIMARY KEY,
  "leagueId" TEXT NOT NULL REFERENCES "leagues"("id") ON DELETE CASCADE,
  "period" INTEGER NOT NULL,
  "slotKey" TEXT NOT NULL,
  "tribeId" TEXT NOT NULL,
  "voterRosterId" TEXT NOT NULL,
  "choice" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "survivor_guillotine_choice_votes_leagueId_period_slotKey_voterRosterId_key" UNIQUE ("leagueId", "period", "slotKey", "voterRosterId")
);
CREATE INDEX IF NOT EXISTS "survivor_guillotine_choice_votes_leagueId_period_slotKey_idx" ON "survivor_guillotine_choice_votes"("leagueId", "period", "slotKey");

CREATE TABLE IF NOT EXISTS "survivor_guillotine_tribe_choices" (
  "id" TEXT PRIMARY KEY,
  "leagueId" TEXT NOT NULL REFERENCES "leagues"("id") ON DELETE CASCADE,
  "rosterId" TEXT NOT NULL,
  "tribeId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "survivor_guillotine_tribe_choices_leagueId_rosterId_key" UNIQUE ("leagueId", "rosterId")
);
CREATE INDEX IF NOT EXISTS "survivor_guillotine_tribe_choices_leagueId_tribeId_idx" ON "survivor_guillotine_tribe_choices"("leagueId", "tribeId");

CREATE TABLE IF NOT EXISTS "survivor_guillotine_daily_lineups" (
  "id" TEXT PRIMARY KEY,
  "leagueId" TEXT NOT NULL REFERENCES "leagues"("id") ON DELETE CASCADE,
  "period" INTEGER NOT NULL,
  "rosterId" TEXT NOT NULL,
  "gameDay" DATE NOT NULL,
  "playerIds" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "survivor_guillotine_daily_lineups_leagueId_period_rosterId_gameDay_key" UNIQUE ("leagueId", "period", "rosterId", "gameDay")
);
CREATE INDEX IF NOT EXISTS "survivor_guillotine_daily_lineups_leagueId_period_gameDay_idx" ON "survivor_guillotine_daily_lineups"("leagueId", "period", "gameDay");

CREATE TABLE IF NOT EXISTS "survivor_guillotine_auction_bids" (
  "id" TEXT PRIMARY KEY,
  "leagueId" TEXT NOT NULL REFERENCES "leagues"("id") ON DELETE CASCADE,
  "period" INTEGER NOT NULL,
  "rosterId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'sealed',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "survivor_guillotine_auction_bids_leagueId_period_rosterId_key" UNIQUE ("leagueId", "period", "rosterId")
);
CREATE INDEX IF NOT EXISTS "survivor_guillotine_auction_bids_leagueId_period_status_idx" ON "survivor_guillotine_auction_bids"("leagueId", "period", "status");

CREATE TABLE IF NOT EXISTS "survivor_guillotine_chops" (
  "id" TEXT PRIMARY KEY,
  "leagueId" TEXT NOT NULL REFERENCES "leagues"("id") ON DELETE CASCADE,
  "period" INTEGER NOT NULL,
  "rosterId" TEXT NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "tribeId" TEXT,
  "releaseSnapshot" JSONB,
  "reversedAt" TIMESTAMP(3),
  "reversalReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "survivor_guillotine_chops_leagueId_period_idx" ON "survivor_guillotine_chops"("leagueId", "period");
CREATE INDEX IF NOT EXISTS "survivor_guillotine_chops_leagueId_period_rosterId_idx" ON "survivor_guillotine_chops"("leagueId", "period", "rosterId");
