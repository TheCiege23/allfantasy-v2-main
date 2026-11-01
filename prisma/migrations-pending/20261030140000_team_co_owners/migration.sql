CREATE TABLE "team_co_owners" (
  "id" TEXT NOT NULL,
  "leagueId" TEXT NOT NULL,
  "rosterId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "invitedByUserId" TEXT NOT NULL,
  "rosterOwnerKey" TEXT NOT NULL,
  "claimedOwnerId" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "team_co_owners_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "team_co_owners_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "team_co_owners_rosterId_fkey" FOREIGN KEY ("rosterId") REFERENCES "rosters"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "team_co_owners_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "team_co_owners_leagueId_userId_key" ON "team_co_owners"("leagueId", "userId");
CREATE INDEX "team_co_owners_rosterId_idx" ON "team_co_owners"("rosterId");
CREATE INDEX "team_co_owners_userId_acceptedAt_idx" ON "team_co_owners"("userId", "acceptedAt");

