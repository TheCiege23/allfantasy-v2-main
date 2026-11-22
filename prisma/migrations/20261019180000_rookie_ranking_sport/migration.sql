-- RookieRanking had no sport column, so any non-NFL row would have surfaced in NFL dynasty ADP,
-- mock-draft boards and the trade analyzer. Additive: every existing row is NFL via the default.
-- The unique key gains sport so the same name/year can exist in two sports.

ALTER TABLE "RookieRanking" ADD COLUMN IF NOT EXISTS "sport" VARCHAR(16) NOT NULL DEFAULT 'NFL';

DROP INDEX IF EXISTS "RookieRanking_year_name_key";
CREATE UNIQUE INDEX IF NOT EXISTS "RookieRanking_sport_year_name_key" ON "RookieRanking"("sport", "year", "name");
CREATE INDEX IF NOT EXISTS "RookieRanking_sport_year_idx" ON "RookieRanking"("sport", "year");
