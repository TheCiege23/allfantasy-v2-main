-- CreateTable
CREATE TABLE "prospect_players" (
    "id" TEXT NOT NULL,
    "sport" VARCHAR(16) NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "sourcePlayerId" VARCHAR(64) NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "position" VARCHAR(16),
    "birthDate" DATE,
    "nationality" VARCHAR(48),
    "currentOrg" VARCHAR(64),
    "currentTeam" VARCHAR(96),
    "currentLevel" VARCHAR(24),
    "draftYear" INTEGER,
    "draftRound" INTEGER,
    "draftPick" INTEGER,
    "draftOverall" INTEGER,
    "draftTeam" VARCHAR(64),
    "etaYear" INTEGER,
    "status" VARCHAR(16) NOT NULL DEFAULT 'prospect',
    "sportsPlayerId" TEXT,
    "payloadHash" VARCHAR(64) NOT NULL,
    "statsPayload" JSONB,
    "rawPayload" JSONB,
    "sourceUpdatedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prospect_players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rookie_eligibility_records" (
    "id" TEXT NOT NULL,
    "sport" VARCHAR(16) NOT NULL,
    "season" INTEGER NOT NULL,
    "playerKey" VARCHAR(160) NOT NULL,
    "isRookie" BOOLEAN NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "basis" TEXT NOT NULL,
    "evidence" JSONB,
    "payloadHash" VARCHAR(64) NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rookie_eligibility_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prospect_players_sport_status_idx" ON "prospect_players"("sport", "status");

-- CreateIndex
CREATE INDEX "prospect_players_sport_draftYear_idx" ON "prospect_players"("sport", "draftYear");

-- CreateIndex
CREATE INDEX "prospect_players_sport_normalizedName_idx" ON "prospect_players"("sport", "normalizedName");

-- CreateIndex
CREATE INDEX "prospect_players_sportsPlayerId_idx" ON "prospect_players"("sportsPlayerId");

-- CreateIndex
CREATE UNIQUE INDEX "prospect_players_sport_source_sourcePlayerId_key" ON "prospect_players"("sport", "source", "sourcePlayerId");

-- CreateIndex
CREATE INDEX "rookie_eligibility_records_sport_season_isRookie_idx" ON "rookie_eligibility_records"("sport", "season", "isRookie");

-- CreateIndex
CREATE UNIQUE INDEX "rookie_eligibility_records_sport_season_playerKey_source_key" ON "rookie_eligibility_records"("sport", "season", "playerKey", "source");

