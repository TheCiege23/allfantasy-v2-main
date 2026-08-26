-- Franchise links: one franchise, more than one platform league.
--
-- A manager running his NFL side on Sleeper and his college side on Fantrax has
-- one team in his head and two leagues in ours. These tables say so, and track
-- whether a deal that spans both actually landed on both.
--
-- NOTE: no foreign key from franchise_league_members to a league table. The pro
-- side lives in "leagues" and the college side in "FantraxLeague", so no single
-- FK can point at both. The resolver treats a missing league as absence.

CREATE TABLE "franchise_links" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "franchise_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "franchise_league_members" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "teamExternalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "franchise_league_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cross_platform_trades" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "summary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cross_platform_trades_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cross_platform_trade_legs" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "sends" JSONB NOT NULL,
    "receives" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "observedAt" TIMESTAMP(3),
    "basis" TEXT,

    CONSTRAINT "cross_platform_trade_legs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "franchise_links_ownerUserId_idx" ON "franchise_links"("ownerUserId");

-- A league belongs to at most one franchise.
CREATE UNIQUE INDEX "franchise_league_members_platform_leagueId_key" ON "franchise_league_members"("platform", "leagueId");
-- A franchise holds each role once; two "college" halves would make the
-- combined view ambiguous.
CREATE UNIQUE INDEX "franchise_league_members_linkId_role_key" ON "franchise_league_members"("linkId", "role");
CREATE INDEX "franchise_league_members_linkId_idx" ON "franchise_league_members"("linkId");

CREATE INDEX "cross_platform_trades_linkId_status_idx" ON "cross_platform_trades"("linkId", "status");

CREATE UNIQUE INDEX "cross_platform_trade_legs_tradeId_role_key" ON "cross_platform_trade_legs"("tradeId", "role");
CREATE INDEX "cross_platform_trade_legs_tradeId_idx" ON "cross_platform_trade_legs"("tradeId");

ALTER TABLE "franchise_league_members" ADD CONSTRAINT "franchise_league_members_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "franchise_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cross_platform_trades" ADD CONSTRAINT "cross_platform_trades_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "franchise_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cross_platform_trade_legs" ADD CONSTRAINT "cross_platform_trade_legs_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "cross_platform_trades"("id") ON DELETE CASCADE ON UPDATE CASCADE;
