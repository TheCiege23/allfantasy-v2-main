-- Late-season handoff: the tribe swap is drawn on the server and sealed until the reveal.
-- Additive; legacy rows keep NULL (already applied).
ALTER TABLE "survivor_tribe_swaps" ADD COLUMN IF NOT EXISTS "revealAt" TIMESTAMP(3);
ALTER TABLE "survivor_tribe_swaps" ADD COLUMN IF NOT EXISTS "revealedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "survivor_tribe_swaps_leagueId_revealedAt_idx" ON "survivor_tribe_swaps"("leagueId", "revealedAt");

-- Owner decision on #2470: leagues that exist before the score-based Exile boss KEEP the Chimmy
-- roster boss. Backfill exileBossMode = chimmy_roster into every existing Survivor league that has no
-- stored value (League.settings JSON is where the setting lives). New leagues get median written at
-- creation. Idempotent: never overwrites a stored value.
UPDATE "leagues"
SET "settings" = jsonb_set(COALESCE("settings", '{}'::jsonb), '{exileBossMode}', '"chimmy_roster"'::jsonb, true)
WHERE "survivorMode" = true
  AND ("settings" IS NULL OR (jsonb_typeof("settings") = 'object' AND NOT ("settings" ? 'exileBossMode')));
