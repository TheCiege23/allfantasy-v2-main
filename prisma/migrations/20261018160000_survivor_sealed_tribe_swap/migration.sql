-- Late-season handoff: the tribe swap is drawn on the server and sealed until the reveal.
-- Additive; legacy rows keep NULL (already applied).
ALTER TABLE "survivor_tribe_swaps" ADD COLUMN IF NOT EXISTS "revealAt" TIMESTAMP(3);
ALTER TABLE "survivor_tribe_swaps" ADD COLUMN IF NOT EXISTS "revealedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "survivor_tribe_swaps_leagueId_revealedAt_idx" ON "survivor_tribe_swaps"("leagueId", "revealedAt");
