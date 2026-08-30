-- A CollegeFootballData athlete id on the identity map, so college projections
-- can reach a college roster.
--
-- WHY THIS COLUMN EXISTS
-- NCAAF projections are already computed and stored: `import-stat-lines` pulls
-- season stat lines from CFBD, `compute-projections` runs every sport, and
-- `AFProjectionSnapshot` holds thousands of NCAAF rows. None of them is readable
-- by any surface a college manager sees, and the reason is not the projection
-- pipeline — it is that the two id spaces cannot meet.
--
--   AFProjectionSnapshot.playerId  for NCAAF is a CFBD athlete id. It arrives via
--                                  FantasyStatLine.playerId, which cfbdPlayerStats
--                                  keys on CFBD's own athlete id.
--   SportsPlayer (NCAAF)           is Rolling-Insights keyed. `sleeperId` is NULL on
--                                  every row, because Sleeper has no college players.
--   PlayerIdentityMap              bridges roster ids to `sleeperId`, which is what
--                                  core-app joins on — and carried no CFBD column.
--
-- So `crosswalkToSleeperIds` resolves nothing for NCAAF, core-app falls back to the
-- raw roster id, `SportsPlayer.sleeperId` matches none of them, and the projections
-- join to nothing. `DevyPlayer.cfbdId` was the only CFBD id anywhere in the schema,
-- and the devy pool is draft-eligible prospects rather than full college rosters.
--
-- NULLABLE, AND DELIBERATELY NOT UNIQUE
-- Nullable because it is only ever populated for NCAAF: every NFL, NBA, NHL, MLB
-- and SOCCER row will hold NULL forever, and that is correct rather than missing
-- data. Not UNIQUE because the backfill that populates it resolves by name and
-- must be free to leave a row unset when the match is ambiguous — a UNIQUE
-- constraint would turn "we could not tell these two players apart" into a write
-- error at backfill time instead of a recorded absence.
--
-- ⚠ THIS MIGRATION MUST BE APPLIED BEFORE THE CODE THAT READS THE COLUMN DEPLOYS.
-- A generated client that knows about a column production lacks raises P2022 on
-- every query that selects it — it does not degrade quietly. Applying the schema
-- change is a separate decision from landing the code.

ALTER TABLE "PlayerIdentityMap" ADD COLUMN "cfbdId" TEXT;

CREATE INDEX "PlayerIdentityMap_cfbdId_idx" ON "PlayerIdentityMap"("cfbdId");
