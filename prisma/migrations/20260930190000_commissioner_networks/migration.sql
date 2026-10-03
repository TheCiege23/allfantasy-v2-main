CREATE TABLE "commissioner_networks" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "commissioner_networks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "commissioner_networks_ownerUserId_idx" ON "commissioner_networks"("ownerUserId");

CREATE TABLE "commissioner_network_members" (
  "id" TEXT NOT NULL,
  "networkId" TEXT NOT NULL,
  "leagueId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'member',
  "label" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commissioner_network_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "commissioner_network_members_networkId_leagueId_key" ON "commissioner_network_members"("networkId", "leagueId");
CREATE UNIQUE INDEX "commissioner_network_members_leagueId_key" ON "commissioner_network_members"("leagueId");
ALTER TABLE "commissioner_network_members" ADD CONSTRAINT "commissioner_network_members_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "commissioner_networks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commissioner_network_members" ADD CONSTRAINT "commissioner_network_members_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
