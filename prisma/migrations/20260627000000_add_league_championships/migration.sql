-- Drift repair: create the `league_championships` table.
--
-- The `LeagueChampionship` model was added to schema.prisma (commit 2474e04fa)
-- without a corresponding migration, so the table was never created. This
-- blocked `finalizeRedraftSeasonChampion` (champion crowning) in every
-- environment whose DB was built from migrations.
--
-- SAFETY: additive only — no DROP/ALTER of existing tables, no data touched.
-- IDEMPOTENT: IF NOT EXISTS guards + a conditional FK add make this safe to
-- apply in environments where the table already exists (cross-env drift).

CREATE TABLE IF NOT EXISTS "league_championships" (
    "id" TEXT NOT NULL,
    "leagueId" VARCHAR(64) NOT NULL,
    "season" INTEGER NOT NULL,
    "championUserId" VARCHAR(64) NOT NULL,
    "teamName" VARCHAR(128),
    "pointsFor" DOUBLE PRECISION,
    "playoffRecord" VARCHAR(32),
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedBy" VARCHAR(64) NOT NULL,

    CONSTRAINT "league_championships_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "league_championships_leagueId_idx" ON "league_championships"("leagueId");
CREATE INDEX IF NOT EXISTS "league_championships_championUserId_idx" ON "league_championships"("championUserId");
CREATE UNIQUE INDEX IF NOT EXISTS "league_championships_leagueId_season_key" ON "league_championships"("leagueId", "season");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'league_championships_leagueId_fkey'
  ) THEN
    ALTER TABLE "league_championships"
      ADD CONSTRAINT "league_championships_leagueId_fkey"
      FOREIGN KEY ("leagueId") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
