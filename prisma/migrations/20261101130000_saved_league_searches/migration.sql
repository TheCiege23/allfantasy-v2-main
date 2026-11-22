-- CreateTable
CREATE TABLE "saved_league_searches" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" VARCHAR(160) NOT NULL,
    "query" VARCHAR(1000) NOT NULL,
    "seenLeagueIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastCheckedAt" TIMESTAMP(3),
    "lastAlertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_league_searches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_league_searches_lastCheckedAt_idx" ON "saved_league_searches"("lastCheckedAt");

-- CreateIndex
CREATE UNIQUE INDEX "saved_league_searches_userId_query_key" ON "saved_league_searches"("userId", "query");

-- AddForeignKey
ALTER TABLE "saved_league_searches" ADD CONSTRAINT "saved_league_searches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

