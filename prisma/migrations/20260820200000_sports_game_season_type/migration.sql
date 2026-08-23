-- Which slate a `sports_games.week` counts within.
--
-- WHY THIS COLUMN HAS TO EXIST
-- `week` was written by digit-stripping the provider's label: API-Sports sends
-- "Pre Season - 1" and the importer stored `1`. Regular-season week 1 also stores
-- `1`. The two are different games between different teams on different dates, and
-- every reader keyed on (sport, season, week) — the live-scoring provider's
-- `fetchActiveGames` most of all — could not tell them apart. During August that
-- query returns preseason games to a regular-season league, and once September
-- arrives it returns BOTH, so a finished preseason game sits in the live slate
-- forever.
--
-- WHY NOT DERIVE IT FROM THE DATE INSTEAD
-- That is what the code did as a stopgap, and it is the weaker answer: the NFL
-- opener moves with Labor Day, week 18 lands in January, and every sport has a
-- different calendar. The feeds already carry the truth verbatim — API-Sports as
-- `game.stage` ("Pre Season" | "Regular Season" | "Post Season"), Rolling Insights
-- as `season_type` — so this column stores what the provider said rather than what
-- a month implies.
--
-- WHY NULLABLE, AND WHY NO BACKFILL
-- NULL means "this row predates the column and we do not know", which is
-- deliberately distinct from a confident "regular". Backfilling every existing row
-- to 'regular' would assert something about ~3,300 rows nobody has verified,
-- including the preseason games that motivated this. Readers treat NULL as
-- unknown and fall back to the previous behaviour, so nothing breaks while the
-- importers refill rows on their normal cadence (import-scores runs every two
-- minutes, and upserts by (sport, externalId, source)).
--
-- WHY NOT PART OF THE UNIQUE KEY
-- The table's identity is (sport, externalId, source) — the provider's own game id
-- already distinguishes a preseason fixture from a regular-season one. Adding
-- seasonType to the unique key would let the same game exist twice if a provider
-- ever relabelled it.
ALTER TABLE "SportsGame" ADD COLUMN IF NOT EXISTS "seasonType" TEXT;

-- Mirrors the (sport, season, week) index that live reads already use, with the
-- discriminator in front of week so a slate-scoped lookup stays index-only.
CREATE INDEX IF NOT EXISTS "SportsGame_sport_season_seasonType_week_idx"
  ON "SportsGame" ("sport", "season", "seasonType", "week");
