-- A manager's "I want this player" mark (the AF crest on the league page's Propose grid and trade
-- block cards). Other managers see only an anonymous count per player.
-- Additive: one new table, no change to any existing table. Generated with `prisma migrate diff`.

-- CreateTable
CREATE TABLE "league_trade_interests" (
    "id" TEXT NOT NULL,
    "leagueId" VARCHAR(64) NOT NULL,
    "userId" VARCHAR(64) NOT NULL,
    "playerId" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "league_trade_interests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_league_trade_interest_player" ON "league_trade_interests"("leagueId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_league_trade_interest" ON "league_trade_interests"("leagueId", "userId", "playerId");
