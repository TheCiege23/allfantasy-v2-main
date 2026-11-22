-- CreateTable
CREATE TABLE "find_league_spot_requests" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "requesterUserId" TEXT NOT NULL,
    "message" VARCHAR(500),
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "responseNote" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "find_league_spot_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "find_league_spot_requests_leagueId_status_idx" ON "find_league_spot_requests"("leagueId", "status");

-- CreateIndex
CREATE INDEX "find_league_spot_requests_requesterUserId_createdAt_idx" ON "find_league_spot_requests"("requesterUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "find_league_spot_requests_leagueId_requesterUserId_key" ON "find_league_spot_requests"("leagueId", "requesterUserId");

-- AddForeignKey
ALTER TABLE "find_league_spot_requests" ADD CONSTRAINT "find_league_spot_requests_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "find_league_spot_requests" ADD CONSTRAINT "find_league_spot_requests_requesterUserId_fkey" FOREIGN KEY ("requesterUserId") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

