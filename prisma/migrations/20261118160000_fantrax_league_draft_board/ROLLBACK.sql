-- Drops the stored draft board and pick inventory. The data is re-fetchable from
-- Fantrax on the next import, so nothing is lost that cannot be read again.
-- Roll the code back FIRST: a client that still knows these columns will raise
-- P2022 on every read of "FantraxLeague" once they are gone.
ALTER TABLE "FantraxLeague" DROP COLUMN IF EXISTS "draftPicks";
ALTER TABLE "FantraxLeague" DROP COLUMN IF EXISTS "draftBoard";
