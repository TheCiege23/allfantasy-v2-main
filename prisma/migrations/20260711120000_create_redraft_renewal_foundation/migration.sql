-- Stage 1: materialize the renewal foundation already represented by Prisma.
-- Deliberately omit IF NOT EXISTS so incompatible pre-existing objects fail visibly.
CREATE TYPE "league_renewal_status" AS ENUM ('pending', 'in_progress', 'completed', 'abandoned');
CREATE TYPE "league_renewal_slot_status" AS ENUM ('invited', 'confirmed', 'declined', 'abandoned');

CREATE TABLE "league_renewals" (
    "id" TEXT NOT NULL,
    "leagueId" VARCHAR(64) NOT NULL,
    "season" INTEGER NOT NULL,
    "renewalKind" VARCHAR(32) NOT NULL,
    "status" "league_renewal_status" NOT NULL DEFAULT 'pending',
    "initiatedBy" VARCHAR(64) NOT NULL,
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "windowClosesAt" TIMESTAMP(3) NOT NULL,
    "executedAt" TIMESTAMP(3),
    "abandonedAt" TIMESTAMP(3),
    "nextSeason" INTEGER,
    CONSTRAINT "league_renewals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "league_renewals_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "league_renewal_slots" (
    "id" TEXT NOT NULL,
    "renewalId" TEXT NOT NULL,
    "leagueId" VARCHAR(64) NOT NULL,
    "userId" VARCHAR(64) NOT NULL,
    "status" "league_renewal_slot_status" NOT NULL DEFAULT 'invited',
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "isReturning" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "league_renewal_slots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "league_renewal_slots_renewalId_fkey" FOREIGN KEY ("renewalId") REFERENCES "league_renewals"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "league_renewals_leagueId_season_key" ON "league_renewals"("leagueId", "season");
CREATE INDEX "league_renewals_leagueId_status_idx" ON "league_renewals"("leagueId", "status");
CREATE INDEX "league_renewals_windowClosesAt_idx" ON "league_renewals"("windowClosesAt");
CREATE UNIQUE INDEX "league_renewal_slots_renewalId_userId_key" ON "league_renewal_slots"("renewalId", "userId");
CREATE INDEX "league_renewal_slots_leagueId_userId_idx" ON "league_renewal_slots"("leagueId", "userId");
CREATE INDEX "league_renewal_slots_renewalId_status_idx" ON "league_renewal_slots"("renewalId", "status");
