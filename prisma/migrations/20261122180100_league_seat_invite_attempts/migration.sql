CREATE TABLE IF NOT EXISTS "league_seat_invites" (
  "id" TEXT NOT NULL,
  "leagueTeamId" TEXT NOT NULL,
  "recipientLabel" VARCHAR(255) NOT NULL,
  "providerMessageId" VARCHAR(128),
  "status" VARCHAR(16) NOT NULL DEFAULT 'SENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "league_seat_invites_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "league_seat_invites_leagueTeamId_fkey" FOREIGN KEY ("leagueTeamId") REFERENCES "league_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "league_seat_invites_providerMessageId_key" ON "league_seat_invites"("providerMessageId");
CREATE INDEX IF NOT EXISTS "league_seat_invites_leagueTeamId_createdAt_idx" ON "league_seat_invites"("leagueTeamId", "createdAt");
