-- Run only after resolving users with multiple claims in the same league.
DROP INDEX IF EXISTS "leagues_fantrax_source_season_key";
DROP INDEX IF EXISTS "LeagueManagerClaim_leagueId_afUserId_idx";
CREATE UNIQUE INDEX "LeagueManagerClaim_leagueId_afUserId_key"
  ON "LeagueManagerClaim"("leagueId", "afUserId");
