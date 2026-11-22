CREATE TABLE "league_award_ballots" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "league_award_ballots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "league_award_ballots_leagueId_createdAt_idx" ON "league_award_ballots"("leagueId", "createdAt");

ALTER TABLE "league_award_ballots" ADD CONSTRAINT "league_award_ballots_leagueId_fkey"
    FOREIGN KEY ("leagueId") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
