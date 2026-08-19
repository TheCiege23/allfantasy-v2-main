-- ============================================================================
-- Rolling Insights ingestion schema — DB-first architecture
--
-- PRINCIPLE: The application NEVER calls Rolling Insights. Only the ingestion
-- worker does. Application code reads exclusively from these tables.
--
-- Layering:
--   L0  raw_*        append-only landing. Immutable. Never updated.
--   L1  dim_*        slowly-changing dimensions (teams, players).
--   L2  fact_*       normalized current state, upserted from raw.
--   L3  event_*      derived domain events (big plays, TDs, injuries).
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS ri;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE ri.sport_code AS ENUM (
  'NFL','NBA','NHL','MLB','NCAAFB','NCAABB','SOCCER','DARTS','PGA'
);

CREATE TYPE ri.soccer_league AS ENUM ('EPL','LALIGA','SERIEA');

CREATE TYPE ri.game_status AS ENUM (
  'scheduled','delayed','postponed','suspended','canceled',
  'inprogress','final','completed'
);

CREATE TYPE ri.event_kind AS ENUM (
  'BIG_PLAY','TOUCHDOWN','FIELD_GOAL','SACK','INTERCEPTION','FUMBLE',
  'TURNOVER','SAFETY','BLOCKED_KICK','INJURY','GAME_START','GAME_FINAL',
  'RED_ZONE','LEAD_CHANGE'
);

CREATE TYPE ri.unit AS ENUM ('OFFENSE','DEFENSE','SPECIAL_TEAMS');

CREATE TYPE ri.confidence AS ENUM ('HIGH','MEDIUM','LOW','INSUFFICIENT');

-- ============================================================================
-- L0 — RAW LANDING (append-only, immutable)
-- ============================================================================
-- Every successful API response lands here verbatim before any parsing.
-- This is what makes re-probing unnecessary: the shape is on disk, queryable.
-- It is also what lets you replay/reprocess after a parser bug without
-- re-hitting the vendor.

CREATE TABLE ri.raw_response (
  id              BIGSERIAL PRIMARY KEY,
  endpoint        TEXT          NOT NULL,   -- 'live','schedule','play_by_play',...
  sport           ri.sport_code NOT NULL,
  league          ri.soccer_league,         -- SOCCER only
  path_date       DATE,                     -- the {date} path arg, if any
  season          INT,                      -- the {season} path arg, if any
  game_id         TEXT,                     -- the game_id query arg, if any
  team_id         TEXT,
  http_status     INT           NOT NULL,
  payload         JSONB,                    -- NULL on non-200
  payload_sha256  TEXT,                     -- dedupe / change detection
  fetched_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  latency_ms      INT,
  -- NEVER store the request URL: it contains RSC_token.
  CONSTRAINT raw_response_no_url CHECK (true)
);

-- Change detection is by payload hash, NOT by HTTP 304.
-- 304 is a cache artifact per the vendor; see ENDPOINTS.yaml transport.
CREATE INDEX raw_response_lookup_idx
  ON ri.raw_response (endpoint, sport, path_date DESC, fetched_at DESC);
CREATE INDEX raw_response_game_idx
  ON ri.raw_response (game_id, fetched_at DESC) WHERE game_id IS NOT NULL;
CREATE INDEX raw_response_hash_idx
  ON ri.raw_response (endpoint, sport, payload_sha256);

-- Retention: keep 30d hot, then archive to cold storage. Do NOT delete
-- game-day raws until the 12h stat-correction window has closed and the
-- reconcile pass has run.

-- ---------------------------------------------------------------------------
-- Fixture capture log — records which endpoint/sport combos have EVER been
-- probed, so agents can see coverage without calling the API.
-- ---------------------------------------------------------------------------
CREATE TABLE ri.contract_probe_log (
  endpoint        TEXT          NOT NULL,
  sport           ri.sport_code NOT NULL,
  league          ri.soccer_league,
  first_probed_at TIMESTAMPTZ   NOT NULL DEFAULT now(),
  last_probed_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  http_status     INT,
  fixture_path    TEXT,      -- contracts/rolling-insights/fixtures/<file>.json
  field_count     INT,
  notes           TEXT,
  PRIMARY KEY (endpoint, sport, league)
);

-- ============================================================================
-- L1 — DIMENSIONS
-- ============================================================================

CREATE TABLE ri.dim_team (
  sport         ri.sport_code NOT NULL,
  league        ri.soccer_league,
  ri_team_id    TEXT          NOT NULL,
  abbrv         TEXT,
  name          TEXT,
  mascot        TEXT,
  division_name TEXT,
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (sport, ri_team_id)
);

CREATE TABLE ri.dim_player (
  sport         ri.sport_code NOT NULL,
  ri_player_id  TEXT          NOT NULL,
  full_name     TEXT,
  position      TEXT,
  position_category TEXT,          -- OFF / DEF / ST
  ri_team_id    TEXT,
  -- Cross-source identity resolution. See the values-pipeline spec: everything
  -- joins through a canonical player_identity table, never directly.
  canonical_player_id UUID,
  gsis_id       TEXT,
  sleeper_id    TEXT,
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (sport, ri_player_id)
);

CREATE INDEX dim_player_canonical_idx ON ri.dim_player (canonical_player_id);
CREATE INDEX dim_player_name_idx      ON ri.dim_player (sport, lower(full_name));

-- ============================================================================
-- L2 — FACTS (current state, upserted)
-- ============================================================================

CREATE TABLE ri.fact_game (
  sport         ri.sport_code NOT NULL,
  league        ri.soccer_league,
  game_id       TEXT          NOT NULL,
  game_date     DATE          NOT NULL,
  season        INT,
  season_type   TEXT,
  home_team_id  TEXT,
  away_team_id  TEXT,
  home_score    INT,
  away_score    INT,
  status        ri.game_status,
  status_raw    TEXT,          -- preserve vendor string verbatim
  game_status   TEXT,          -- clock/quarter string; support both this and status
  scheduled_at  TIMESTAMPTZ,
  -- Stat-correction tracking (vendor reprocesses ~12h post-game)
  finalized_at        TIMESTAMPTZ,
  reconciled_at       TIMESTAMPTZ,
  correction_count    INT NOT NULL DEFAULT 0,
  last_raw_id   BIGINT REFERENCES ri.raw_response(id),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (sport, game_id)
);

CREATE INDEX fact_game_date_idx   ON ri.fact_game (game_date, sport);
CREATE INDEX fact_game_active_idx ON ri.fact_game (sport, status)
  WHERE status IN ('inprogress','scheduled','delayed');
-- Games needing a stat-correction reconcile pass:
CREATE INDEX fact_game_reconcile_idx ON ri.fact_game (finalized_at)
  WHERE reconciled_at IS NULL AND finalized_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Player game lines. Sport-specific stats live in JSONB because the vendor's
-- payload shape differs per sport and is UNDOCUMENTED for NHL/NCAA*/SOCCER.
-- Do not flatten into columns until a fixture confirms the field list.
-- ---------------------------------------------------------------------------
CREATE TABLE ri.fact_player_game (
  sport         ri.sport_code NOT NULL,
  game_id       TEXT          NOT NULL,
  ri_player_id  TEXT          NOT NULL,
  ri_team_id    TEXT,
  player_status TEXT,          -- e.g. 'ACT'
  position      TEXT,
  stats         JSONB         NOT NULL,   -- verbatim vendor stat object
  -- Denormalized hot path for event detection. NULL where sport lacks the field.
  passing_yards       NUMERIC,
  passing_touchdowns  INT,
  passing_interceptions INT,
  rushing_yards       NUMERIC,
  rushing_touchdowns  INT,
  rushing_long        NUMERIC,   -- ⚠️ MONOTONIC: longest-so-far, not per-play
  receiving_yards     NUMERIC,
  receiving_touchdowns INT,
  fumbles_lost        INT,
  -- Do NOT use vendor DK_fantasy_points for league scoring; DraftKings only.
  dk_fantasy_points   NUMERIC,
  is_provisional      BOOLEAN NOT NULL DEFAULT true,  -- false only after reconcile
  last_raw_id   BIGINT REFERENCES ri.raw_response(id),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (sport, game_id, ri_player_id)
);

CREATE INDEX fact_player_game_player_idx ON ri.fact_player_game (sport, ri_player_id);
CREATE INDEX fact_player_game_stats_gin  ON ri.fact_player_game USING GIN (stats);

-- Previous-snapshot table: event detection diffs current vs previous.
-- Kept separate so fact_player_game stays a clean "current state" read for the app.
CREATE TABLE ri.fact_player_game_prev (
  sport         ri.sport_code NOT NULL,
  game_id       TEXT          NOT NULL,
  ri_player_id  TEXT          NOT NULL,
  stats         JSONB         NOT NULL,
  captured_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (sport, game_id, ri_player_id)
);

CREATE TABLE ri.fact_team_game (
  sport         ri.sport_code NOT NULL,
  game_id       TEXT          NOT NULL,
  ri_team_id    TEXT          NOT NULL,
  is_home       BOOLEAN,
  score         INT,
  stats         JSONB         NOT NULL,
  -- Denormalized DST/ST hot path (NFL/NCAAFB)
  sacks                 NUMERIC,
  defense_interceptions INT,
  defense_touchdowns    INT,
  defense_fumble_recoveries INT,
  safeties              INT,
  forced_fumbles        INT,
  kick_return_touchdowns  INT,
  punt_return_touchdowns  INT,
  blocked_kick_touchdowns INT,
  blocked_punt_touchdowns INT,
  interception_touchdowns INT,
  fumble_return_touchdowns INT,
  points_against_defense_special_teams INT,
  is_provisional BOOLEAN NOT NULL DEFAULT true,
  last_raw_id   BIGINT REFERENCES ri.raw_response(id),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (sport, game_id, ri_team_id)
);

CREATE TABLE ri.fact_team_game_prev (
  sport         ri.sport_code NOT NULL,
  game_id       TEXT          NOT NULL,
  ri_team_id    TEXT          NOT NULL,
  stats         JSONB         NOT NULL,
  captured_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (sport, game_id, ri_team_id)
);

-- ---------------------------------------------------------------------------
-- Play-by-play. MLB / NBA / NFL ONLY. See ENDPOINTS.yaml support_matrix.
-- ---------------------------------------------------------------------------
CREATE TABLE ri.fact_play (
  sport         ri.sport_code NOT NULL,
  game_id       TEXT          NOT NULL,
  seq           INT           NOT NULL,
  period        INT,                     -- quarter / inning / period
  period_half   TEXT,                    -- MLB 'top'/'bottom'
  play_type     TEXT,
  description   TEXT,
  yards         NUMERIC,
  score_home    INT,
  score_away    INT,
  raw           JSONB         NOT NULL,
  last_raw_id   BIGINT REFERENCES ri.raw_response(id),
  PRIMARY KEY (sport, game_id, seq)
);

CREATE INDEX fact_play_bigplay_idx ON ri.fact_play (sport, game_id, yards DESC)
  WHERE yards >= 20;

-- ---------------------------------------------------------------------------
-- Injuries. MLB / NFL / NBA / NHL ONLY. No NCAA, no SOCCER.
-- ---------------------------------------------------------------------------
CREATE TABLE ri.fact_injury (
  sport         ri.sport_code NOT NULL,
  ri_player_id  TEXT          NOT NULL,
  ri_team_id    TEXT,
  injury        TEXT,          -- 'Knee', 'Hamstring', ...
  returns       TEXT,          -- 'Week To Week', 'Out For Season'
  date_injured  DATE,
  first_seen_at TIMESTAMPTZ   NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  cleared_at    TIMESTAMPTZ,   -- set when player drops off the feed
  -- Vendor gives no practice-participation grid (DNP/Limited/Full).
  -- Parse official league injury reports separately for that.
  source        TEXT          NOT NULL DEFAULT 'rolling_insights',
  PRIMARY KEY (sport, ri_player_id, date_injured)
);

CREATE INDEX fact_injury_active_idx ON ri.fact_injury (sport, ri_team_id)
  WHERE cleared_at IS NULL;

CREATE TABLE ri.fact_depth_chart (
  sport        ri.sport_code NOT NULL,
  ri_team_id   TEXT          NOT NULL,
  position     TEXT          NOT NULL,
  depth_order  INT           NOT NULL,
  ri_player_id TEXT,
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (sport, ri_team_id, position, depth_order)
);

-- ============================================================================
-- L3 — DERIVED EVENTS
-- ============================================================================

CREATE TABLE ri.event_game (
  id            BIGSERIAL PRIMARY KEY,
  sport         ri.sport_code NOT NULL,
  game_id       TEXT          NOT NULL,
  kind          ri.event_kind NOT NULL,
  unit          ri.unit,
  ri_player_id  TEXT,
  ri_team_id    TEXT,
  yards         NUMERIC,
  detail        JSONB,
  -- Provenance: which detection path produced this.
  detected_from TEXT NOT NULL,     -- 'play_by_play' | 'box_diff'
  detection_confidence ri.confidence NOT NULL,
  -- Idempotency: prevents duplicate notifications across polls and retries.
  dedupe_key    TEXT          NOT NULL,
  occurred_at   TIMESTAMPTZ,
  detected_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (dedupe_key)
);

CREATE INDEX event_game_recent_idx ON ri.event_game (detected_at DESC);
CREATE INDEX event_game_lookup_idx ON ri.event_game (sport, game_id, kind);
CREATE INDEX event_game_player_idx ON ri.event_game (ri_player_id, detected_at DESC);

COMMENT ON COLUMN ri.event_game.detection_confidence IS
  'box_diff detection is LOW for repeat big plays: rushing_long is monotonic, so '
  'only the FIRST 20+ yard play per player per game is detectable. play_by_play '
  'detection is HIGH. Surface this to users rather than implying completeness.';

-- ============================================================================
-- SCHEDULER / POLLING CONTROL
-- ============================================================================

CREATE TABLE ri.poll_job (
  id            BIGSERIAL PRIMARY KEY,
  endpoint      TEXT          NOT NULL,
  sport         ri.sport_code NOT NULL,
  league        ri.soccer_league,
  path_date     DATE,
  game_id       TEXT,
  interval_sec  INT           NOT NULL,
  next_run_at   TIMESTAMPTZ   NOT NULL,
  last_run_at   TIMESTAMPTZ,
  last_status   INT,
  last_hash     TEXT,          -- payload_sha256; unchanged hash = no-op downstream
  consecutive_failures INT NOT NULL DEFAULT 0,
  enabled       BOOLEAN       NOT NULL DEFAULT true,
  UNIQUE (endpoint, sport, league, path_date, game_id)
);

CREATE INDEX poll_job_due_idx ON ri.poll_job (next_run_at)
  WHERE enabled = true;

-- Cadence reference (see INTEGRATION.md §4):
--   live, game in progress ......... 35s   (user requirement: 30-45s)
--   injuries, game day ............. 35s
--   play_by_play, game in progress . 35s   (MLB/NBA/NFL only)
--   live, game scheduled <30m out .. 60s
--   schedule, daily ................ 1/day 06:00 local + 1/hr on game days
--   injuries, non-game day ......... 1/hour
--   team_info / player_info ........ 1/day
--   team_stats / player_stats ...... 1/day (offseason: 1/week)
--   depth_charts ................... 1/day
--   reconcile finalized games ...... hourly for 12h after finalized_at
-- Vendor recommends >= 5s between calls. 35s is comfortably above the floor.

-- ============================================================================
-- APP-FACING READ VIEWS
-- The application queries these. It must never call the vendor API.
-- ============================================================================

CREATE VIEW ri.v_live_scoreboard AS
SELECT g.sport, g.league, g.game_id, g.game_date, g.status, g.game_status,
       ht.abbrv AS home_abbrv, g.home_score,
       at.abbrv AS away_abbrv, g.away_score,
       g.updated_at
FROM ri.fact_game g
LEFT JOIN ri.dim_team ht ON ht.sport = g.sport AND ht.ri_team_id = g.home_team_id
LEFT JOIN ri.dim_team at ON at.sport = g.sport AND at.ri_team_id = g.away_team_id
WHERE g.status IN ('inprogress','final','completed','delayed','suspended');

CREATE VIEW ri.v_recent_events AS
SELECT e.*, p.full_name, t.abbrv
FROM ri.event_game e
LEFT JOIN ri.dim_player p ON p.sport = e.sport AND p.ri_player_id = e.ri_player_id
LEFT JOIN ri.dim_team   t ON t.sport = e.sport AND t.ri_team_id   = e.ri_team_id
WHERE e.detected_at > now() - INTERVAL '6 hours'
ORDER BY e.detected_at DESC;

CREATE VIEW ri.v_active_injuries AS
SELECT i.sport, i.ri_player_id, p.full_name, p.position,
       i.ri_team_id, t.abbrv, i.injury, i.returns, i.date_injured, i.last_seen_at
FROM ri.fact_injury i
LEFT JOIN ri.dim_player p ON p.sport = i.sport AND p.ri_player_id = i.ri_player_id
LEFT JOIN ri.dim_team   t ON t.sport = i.sport AND t.ri_team_id   = i.ri_team_id
WHERE i.cleared_at IS NULL;

-- Data-freshness view. Surface this in the UI rather than implying live-ness.
CREATE VIEW ri.v_feed_health AS
SELECT endpoint, sport, league,
       max(fetched_at)                              AS last_success_at,
       now() - max(fetched_at)                      AS staleness,
       count(*) FILTER (WHERE http_status = 200
                        AND fetched_at > now() - INTERVAL '1 hour') AS ok_last_hour,
       count(*) FILTER (WHERE http_status = 304
                        AND fetched_at > now() - INTERVAL '1 hour') AS cache_304_last_hour,
       count(*) FILTER (WHERE http_status NOT IN (200,304)
                        AND fetched_at > now() - INTERVAL '1 hour') AS errors_last_hour
FROM ri.raw_response
GROUP BY endpoint, sport, league;
