-- In-place imported -> native switchover (docs/league-import/IN_PLACE_NATIVE_CONVERSION_PLAN.md, step 3).
-- One row per converted league: the provider identity the switch overwrites, the pre-switch snapshot for undo
-- (open until the first native season starts), and the switch status. Additive only: no existing table changes.
-- CreateTable
CREATE TABLE "league_native_conversions" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'snapshotted',
    "fromPlatform" VARCHAR(24) NOT NULL,
    "fromPlatformLeagueId" TEXT NOT NULL,
    "fromSeason" INTEGER NOT NULL,
    "convertedByUserId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "snapshotVersion" INTEGER NOT NULL DEFAULT 1,
    "convertedAt" TIMESTAMP(3),
    "undoClosedAt" TIMESTAMP(3),
    "undoneAt" TIMESTAMP(3),
    "undoneByUserId" TEXT,
    "error" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "league_native_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "league_native_conversions_leagueId_key" ON "league_native_conversions"("leagueId");

-- CreateIndex
CREATE INDEX "league_native_conversions_fromPlatform_fromPlatformLeagueId_idx" ON "league_native_conversions"("fromPlatform", "fromPlatformLeagueId", "fromSeason");

-- CreateIndex
CREATE INDEX "league_native_conversions_status_idx" ON "league_native_conversions"("status");

-- AddForeignKey
ALTER TABLE "league_native_conversions" ADD CONSTRAINT "league_native_conversions_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

