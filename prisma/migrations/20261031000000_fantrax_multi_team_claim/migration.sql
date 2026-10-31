-- One Fantrax account may own several teams in the same league. The team remains
-- unique, while a user can hold more than one distinct team claim.
DROP INDEX IF EXISTS "LeagueManagerClaim_leagueId_afUserId_key";
CREATE INDEX IF NOT EXISTS "LeagueManagerClaim_leagueId_afUserId_idx"
  ON "LeagueManagerClaim"("leagueId", "afUserId");

-- New live imports carry a marker in settings. Legacy UUID-based imports do
-- not, so they are unaffected while concurrent live imports share one row.
CREATE UNIQUE INDEX IF NOT EXISTS "leagues_fantrax_source_season_key"
  ON "leagues"("platformLeagueId", "season")
  WHERE "platform" = 'fantrax'
    AND ("settings"->>'fantraxSourceLeagueId') IS NOT NULL;
