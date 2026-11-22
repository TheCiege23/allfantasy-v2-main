-- One elimination row per team per week. Without it, two runs of the same week (an expired
-- elimination lock, or two worker replicas) could each record the chop and decrement the season's
-- team count twice. See lib/guillotine/guillotineChopAudit.ts.
--
-- A duplicate already in the table is the same fact recorded twice, so the earliest row is kept and
-- the later copies are removed first; otherwise the unique index cannot be built.
DELETE FROM "guillotine_eliminations" AS later
USING "guillotine_eliminations" AS earlier
WHERE later."seasonId" = earlier."seasonId"
  AND later."scoringPeriod" = earlier."scoringPeriod"
  AND later."eliminatedRosterId" = earlier."eliminatedRosterId"
  AND (later."eliminatedAt", later."id") > (earlier."eliminatedAt", earlier."id");

CREATE UNIQUE INDEX "guillotine_eliminations_seasonId_scoringPeriod_eliminatedRo_key"
  ON "guillotine_eliminations"("seasonId", "scoringPeriod", "eliminatedRosterId");
