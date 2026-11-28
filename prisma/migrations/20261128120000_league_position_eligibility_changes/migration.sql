-- Commissioner position-eligibility log (docs/audits/nba-position-eligibility-2026-11.md, fix #1).
-- Append-only: one row per add / remove / reset a commissioner makes for one player in one league.
-- Additive only: no existing table changes.
-- CreateTable
CREATE TABLE "league_position_eligibility_changes" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "playerId" VARCHAR(64) NOT NULL,
    "playerName" VARCHAR(120) NOT NULL,
    "position" VARCHAR(4) NOT NULL,
    "action" VARCHAR(8) NOT NULL,
    "reason" VARCHAR(280),
    "actorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "league_position_eligibility_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "league_position_eligibility_changes_leagueId_createdAt_idx" ON "league_position_eligibility_changes"("leagueId", "createdAt");

-- CreateIndex
CREATE INDEX "league_position_eligibility_changes_leagueId_playerId_idx" ON "league_position_eligibility_changes"("leagueId", "playerId");

-- AddForeignKey
ALTER TABLE "league_position_eligibility_changes" ADD CONSTRAINT "league_position_eligibility_changes_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
