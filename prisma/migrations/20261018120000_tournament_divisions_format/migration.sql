-- Divisions & conferences tournament format (additive).
-- A tournament shell gains a format and its settings; divisions get their own table;
-- conferences gain a library image; leagues gain the division they belong to.

ALTER TABLE "tournament_shells" ADD COLUMN IF NOT EXISTS "format" TEXT NOT NULL DEFAULT 'points_race';
ALTER TABLE "tournament_shells" ADD COLUMN IF NOT EXISTS "formatSettings" JSONB;

ALTER TABLE "tournament_shell_conferences" ADD COLUMN IF NOT EXISTS "imagePath" TEXT;

CREATE TABLE IF NOT EXISTS "tournament_shell_divisions" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "divisionNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sideId" TEXT NOT NULL,
    "emblem" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tournament_shell_divisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tournament_shell_divisions_tournamentId_divisionNumber_key" ON "tournament_shell_divisions"("tournamentId", "divisionNumber");
CREATE INDEX IF NOT EXISTS "tournament_shell_divisions_tournamentId_idx" ON "tournament_shell_divisions"("tournamentId");

DO $$ BEGIN
  ALTER TABLE "tournament_shell_divisions" ADD CONSTRAINT "tournament_shell_divisions_tournamentId_fkey"
    FOREIGN KEY ("tournamentId") REFERENCES "tournament_shells"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "tournament_shell_leagues" ADD COLUMN IF NOT EXISTS "divisionId" TEXT;
CREATE INDEX IF NOT EXISTS "tournament_shell_leagues_divisionId_idx" ON "tournament_shell_leagues"("divisionId");

DO $$ BEGIN
  ALTER TABLE "tournament_shell_leagues" ADD CONSTRAINT "tournament_shell_leagues_divisionId_fkey"
    FOREIGN KEY ("divisionId") REFERENCES "tournament_shell_divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
