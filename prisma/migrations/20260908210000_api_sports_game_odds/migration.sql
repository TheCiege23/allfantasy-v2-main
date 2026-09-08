-- Game odds — the first betting-market table in this schema.
--
-- WHY IT DID NOT EXIST. `lib/api-sports.ts` has implemented `odds`,
-- `odds/bookmakers` and `odds/bets` for a long time, and a census on 2026-09-08
-- found ALL THREE had zero callers and no persistence anywhere. Two surfaces had
-- already written the absence into their own copy as an apology:
--   lib/matchup-prep-dashboard/runMatchupPrepDashboard.ts:497
--       "Not Vegas — fantasy points only."
--   lib/lineup-preference-learning/rules.ts:44
--       "...when Vegas/matchup data is flat."
-- So the fetchers existed, the product wanted the numbers, and nothing connected
-- the two. This table is that connection.
--
-- 🛑 THE WRITER LANDS WITH THE READ. Root CLAUDE.md's worked example is
-- `ingestCFBDStats`: a table nothing refreshes is worse than the live call it
-- replaced, because it fails silently and looks correct. Shipping alongside:
--   writer  lib/api-sports.ts → syncAPISportsGameOddsToDb
--   caller  /api/cron/import-schedules?odds=1, every 6h in cron-schedule.json
--   read    lib/odds/gameOddsReads.ts (DB-first; no provider call on any path)
--
-- ⚠ NO FOREIGN KEY ON `game_external_id`, and that is deliberate twice over.
-- `SportsGame`'s uniqueness is the COMPOSITE [sport, externalId, source], so a
-- single-column reference could not point at it anyway; and this schema carries
-- more than one league/game id space, which `recent_player_searches` and
-- `commissioner_workspace_tasks` both already record as a reason not to fail a
-- page render over a constraint. A missing join yields no odds, not a 500.
--
-- ⚠ EVERY MARKET COLUMN IS NULLABLE, ON PURPOSE. A missing spread and a pick-em
-- are different facts, and a total of 0 is not a total. The normalizer in
-- lib/odds/normalizeApiSportsOdds.ts writes NULL for anything it cannot parse and
-- never substitutes a zero, because a plausible wrong number in the right column
-- is the failure mode this repo keeps paying for.
--
-- ⚠ `unrecognized_bets` IS A DIAGNOSTIC COLUMN AND IS LOAD-BEARING. The v1 docs
-- were read on 2026-09-08 and they pin the envelope (`/odds` needs a REQUIRED
-- `game` id; prices exist 1-7 days pre-match; 78 bet types across 18 bookmakers)
-- but every response sample in them is COLLAPSED, so not one literal bet name
-- appears. The market names the normalizer matches on are therefore still informed
-- guesses. Storing the names it did not recognise turns a wrong guess into a
-- visible row instead of into silently-empty columns. `raw` is kept for the same
-- reason: the first real payload is what tells us which aliases to widen — and
-- `/odds/bets` would list all 78 in a single call whenever someone wants to settle
-- it properly.

CREATE TABLE IF NOT EXISTS "game_odds" (
  "id"                   TEXT NOT NULL,

  -- "NFL" | "NCAAF" today. Matches SportsGame.sport.
  "sport"                VARCHAR(16) NOT NULL,

  -- The PROVIDER's game id, joined to SportsGame.externalId for the same source.
  "game_external_id"     VARCHAR(64) NOT NULL,

  -- Provider tag, e.g. 'api_sports'. Present so a second odds provider can land
  -- beside the first without a migration, exactly as SportsGame.source allows.
  "source"               VARCHAR(32) NOT NULL,

  "bookmaker_id"         INTEGER NOT NULL,
  "bookmaker_name"       VARCHAR(96) NOT NULL,

  -- Denormalized from SportsGame so a week's odds can be read without a join.
  "season"               INTEGER,
  "week"                 INTEGER,
  "season_type"          VARCHAR(24),
  "commence_time"        TIMESTAMP(3),

  -- Spread from the HOME perspective; negative = home favoured (-3.5 = home gives 3.5).
  "spread_home"          DOUBLE PRECISION,
  "spread_home_odd"      DOUBLE PRECISION,
  "spread_away_odd"      DOUBLE PRECISION,

  -- DECIMAL odds (2.50 = +150). American prices are converted on ingest so that
  -- every consumer reads one format; the untouched original stays in "raw".
  "moneyline_home"       DOUBLE PRECISION,
  "moneyline_away"       DOUBLE PRECISION,

  "total_points"         DOUBLE PRECISION,
  "over_odd"             DOUBLE PRECISION,
  "under_odd"            DOUBLE PRECISION,

  -- Derived, not quoted: total/2 -/+ spread/2. NULL unless BOTH inputs parsed,
  -- because half the inputs give half an answer that looks like a whole one.
  -- This is the column fantasy actually wants: a team implied for 30 is a
  -- different start/sit case from the same team implied for 16.
  "implied_home_total"   DOUBLE PRECISION,
  "implied_away_total"   DOUBLE PRECISION,

  -- Vig removed: (1/home) / (1/home + 1/away). NULL unless both sides parsed.
  "home_win_probability" DOUBLE PRECISION,

  "unrecognized_bets"    JSONB,
  "raw"                  JSONB,

  "fetched_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at"           TIMESTAMP(3) NOT NULL,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL,

  CONSTRAINT "game_odds_pkey" PRIMARY KEY ("id")
);

-- One row per book per game per provider. This is the upsert key the writer
-- targets, so re-running the cron refreshes prices in place rather than
-- accumulating a new copy of the same market on every fire.
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_game_odds_book"
  ON "game_odds" ("sport", "game_external_id", "source", "bookmaker_id");

-- The read path: every book for one game.
CREATE INDEX IF NOT EXISTS "game_odds_sport_game_idx"
  ON "game_odds" ("sport", "game_external_id");

-- The other read path: a whole week's slate at once, for lineup/matchup surfaces.
CREATE INDEX IF NOT EXISTS "game_odds_sport_season_week_idx"
  ON "game_odds" ("sport", "season", "week");

-- Staleness sweeps.
CREATE INDEX IF NOT EXISTS "game_odds_expires_at_idx"
  ON "game_odds" ("expires_at");
