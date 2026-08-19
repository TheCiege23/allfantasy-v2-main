-- Fantasy OS Phase 0 finding: the `FranchiseSeason` model (`@@map("franchise_seasons")`)
-- has been present in schema.prisma with a real relation to `League` for some time,
-- but no migration ever created its table -- confirmed absent in production via a
-- read-only information_schema query. `lib/rank/deriveNativeLeagueRows.ts` reads this
-- table for native-league career rank, and `RedraftOffseasonService.ts` now writes to
-- it at season-finalize; without this table that write hard-fails the season-finalize
-- transaction. Purely additive: creates one new table, no existing data touched.
CREATE TABLE "franchise_seasons" (
    "id" TEXT NOT NULL,
    "leagueId" VARCHAR(64) NOT NULL,
    "rosterId" VARCHAR(64) NOT NULL,
    "userId" VARCHAR(64),
    "season" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "ties" INTEGER NOT NULL DEFAULT 0,
    "pointsFor" DOUBLE PRECISION,
    "pointsAgainst" DOUBLE PRECISION,
    "madePlayoffs" BOOLEAN NOT NULL DEFAULT false,
    "wonChampionship" BOOLEAN NOT NULL DEFAULT false,
    "runnerUp" BOOLEAN NOT NULL DEFAULT false,
    "finalRank" INTEGER,
    "keeperCount" INTEGER NOT NULL DEFAULT 0,
    "faabSpent" INTEGER NOT NULL DEFAULT 0,
    "tradeCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "franchise_seasons_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "franchise_seasons_leagueId_rosterId_season_key" ON "franchise_seasons"("leagueId", "rosterId", "season");

CREATE INDEX "franchise_seasons_leagueId_season_idx" ON "franchise_seasons"("leagueId", "season");

CREATE INDEX "franchise_seasons_rosterId_idx" ON "franchise_seasons"("rosterId");

CREATE INDEX "franchise_seasons_leagueId_wonChampionship_idx" ON "franchise_seasons"("leagueId", "wonChampionship");

ALTER TABLE "franchise_seasons" ADD CONSTRAINT "franchise_seasons_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
