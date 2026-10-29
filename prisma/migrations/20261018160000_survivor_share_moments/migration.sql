-- Survivor share cards: one row per shareable moment (immunity, out, idol, exile, champ).
-- Additive only. The payload holds published facts; ballots and voters are never stored here.
CREATE TABLE IF NOT EXISTS "survivor_share_moments" (
  "id" TEXT NOT NULL,
  "leagueId" VARCHAR(64) NOT NULL,
  "type" VARCHAR(16) NOT NULL,
  "week" INTEGER NOT NULL,
  "subjectUserId" VARCHAR(64) NOT NULL,
  "subjectRosterId" VARCHAR(64),
  "dedupeKey" VARCHAR(191) NOT NULL,
  "payload" JSONB NOT NULL,
  "final" BOOLEAN NOT NULL DEFAULT true,
  "publishedAt" TIMESTAMP(3),
  "publishedBy" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "survivor_share_moments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "survivor_share_moments_leagueId_dedupeKey_key" ON "survivor_share_moments"("leagueId", "dedupeKey");
CREATE INDEX IF NOT EXISTS "survivor_share_moments_leagueId_createdAt_idx" ON "survivor_share_moments"("leagueId", "createdAt");
CREATE INDEX IF NOT EXISTS "survivor_share_moments_subjectUserId_idx" ON "survivor_share_moments"("subjectUserId");
