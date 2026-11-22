CREATE TABLE "pirate_protection_sets" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "rosterId" TEXT NOT NULL,
    "playerIds" JSONB NOT NULL DEFAULT '[]',
    "lockAt" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "voidReason" VARCHAR(64),
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pirate_protection_sets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pirate_claims" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "matchupId" TEXT NOT NULL,
    "winnerRosterId" TEXT NOT NULL,
    "loserRosterId" TEXT NOT NULL,
    "playerId" TEXT,
    "offeredPlayerId" TEXT,
    "counterPlayerId" TEXT,
    "status" VARCHAR(32) NOT NULL DEFAULT 'awaiting_selection',
    "deadlineAt" TIMESTAMP(3),
    "selectedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "transferredAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pirate_claims_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pirate_protection_sets_leagueId_seasonId_week_rosterId_key"
  ON "pirate_protection_sets"("leagueId", "seasonId", "week", "rosterId");
CREATE INDEX "pirate_protection_sets_leagueId_seasonId_week_idx"
  ON "pirate_protection_sets"("leagueId", "seasonId", "week");
CREATE UNIQUE INDEX "pirate_claims_matchupId_key" ON "pirate_claims"("matchupId");
CREATE INDEX "pirate_claims_leagueId_seasonId_week_idx" ON "pirate_claims"("leagueId", "seasonId", "week");
CREATE INDEX "pirate_claims_status_deadlineAt_idx" ON "pirate_claims"("status", "deadlineAt");
CREATE INDEX "pirate_claims_loserRosterId_playerId_status_idx" ON "pirate_claims"("loserRosterId", "playerId", "status");
ALTER TABLE "pirate_protection_sets" ADD CONSTRAINT "pirate_protection_sets_leagueId_fkey"
  FOREIGN KEY ("leagueId") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pirate_claims" ADD CONSTRAINT "pirate_claims_leagueId_fkey"
  FOREIGN KEY ("leagueId") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pirate_claims" ADD CONSTRAINT "pirate_claims_matchupId_fkey"
  FOREIGN KEY ("matchupId") REFERENCES "redraft_matchups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
