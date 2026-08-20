-- ============================================================================
-- TheSportsDB ingestion schema — metadata / media / TV / highlights
--
-- ROLE BOUNDARY: this source enriches. It does NOT score.
-- Live stats come from Rolling Insights (schema `ri`). Never join a fantasy
-- score to anything in this schema.
--
-- Cadence is slow: most of this is daily or weekly. Only livescore is game-day,
-- and it is a 2-minute BATCH, not a push.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS tsdb;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE tsdb.media_kind AS ENUM (
  'team_badge','team_logo','team_banner','team_fanart','team_equipment',
  'league_badge','league_logo','league_banner','league_poster','league_trophy','league_fanart',
  'player_thumb','player_cutout','player_render','player_poster','player_banner','player_fanart',
  'event_poster','event_square','event_thumb','event_fanart','event_banner','event_map',
  'venue_thumb','venue_logo','venue_map','venue_fanart'
);

-- Artwork rights posture. See README.md — this is the highest-risk area.
CREATE TYPE tsdb.media_rights AS ENUM (
  'CC_LICENSED',      -- strCreativeCommons == 'Yes'. Safest.
  'TRADEMARK_ASIS',   -- badges/logos. Display unmodified only, no endorsement implied.
  'UNKNOWN',          -- fan-created, no license signal. Default. Do NOT display.
  'BLOCKED'           -- manually blocked (DMCA, or policy decision)
);

-- ============================================================================
-- L0 — RAW LANDING (append-only)
-- ============================================================================
CREATE TABLE tsdb.raw_response (
  id             BIGSERIAL PRIMARY KEY,
  api_version    SMALLINT    NOT NULL CHECK (api_version IN (1,2)),
  endpoint       TEXT        NOT NULL,   -- 'eventsday','lookupplayerstats','livescore',...
  request_args   JSONB       NOT NULL,   -- ⚠️ NEVER include the api key
  http_status    INT         NOT NULL,
  -- ⚠️ v1 returns 200 on errors. `api_error` captures the body's Message key so
  -- downstream code never mistakes a 200 for success.
  api_error      TEXT,
  payload        JSONB,
  payload_sha256 TEXT,
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX tsdb_raw_lookup_idx ON tsdb.raw_response (endpoint, fetched_at DESC);
CREATE INDEX tsdb_raw_error_idx  ON tsdb.raw_response (fetched_at DESC) WHERE api_error IS NOT NULL;

CREATE TABLE tsdb.contract_probe_log (
  api_version     SMALLINT NOT NULL,
  endpoint        TEXT     NOT NULL,
  sport           TEXT,
  league_id       INT,
  first_probed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_probed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  http_status     INT,
  returned_null   BOOLEAN,     -- true = endpoint exists but has no data for this sport
  fixture_path    TEXT,
  notes           TEXT,
  PRIMARY KEY (api_version, endpoint, sport, league_id)
);

-- Seed the empirically-confirmed NFL nulls so nobody re-probes them.
INSERT INTO tsdb.contract_probe_log
  (api_version, endpoint, sport, league_id, http_status, returned_null, notes)
VALUES
  (1,'lookupeventstats','American Football',4391,200,true,
   'Probed events 2475349 and 2261187 -> {"eventstats":null}. Soccer control returned 5 rows. WONTFIX.'),
  (1,'lookuptimeline','American Football',4391,200,true,
   'Probed events 2475349 and 2261187 -> {"timeline":null}. Soccer-only vocabulary. WONTFIX.'),
  (1,'lookuplineup','American Football',4391,200,true,
   'Probed events 2475349 and 2261187 -> {"lineup":null}. WONTFIX.'),
  (1,'lookupplayerstats','American Football',4391,200,false,
   'WORKS. Season aggregates only. Verified Jalen Hurts 2024/2023.')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- L1 — REFERENCE DATA
-- ============================================================================
CREATE TABLE tsdb.league (
  id_league          INT  PRIMARY KEY,
  str_league         TEXT,
  str_league_alt     TEXT,
  str_sport          TEXT,
  str_country        TEXT,
  int_division       INT,
  str_current_season TEXT,
  int_formed_year    INT,
  str_naming         TEXT,        -- template, e.g. '{strHomeTeam} vs {strAwayTeam}'
  id_apifootball     TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Known IDs. NCAA Football's name is the trap: "NCAA Division 1", not "NCAA Football".
INSERT INTO tsdb.league (id_league, str_league, str_sport) VALUES
  (4391,'NFL','American Football'),
  (4479,'NCAA Division 1','American Football'),
  (4405,'CFL','American Football'),
  (4424,'MLB','Baseball'),
  (4387,'NBA','Basketball'),
  (4328,'English Premier League','Soccer')
ON CONFLICT (id_league) DO NOTHING;

CREATE TABLE tsdb.team (
  id_team          TEXT PRIMARY KEY,
  str_team         TEXT,
  str_team_alt     TEXT,
  str_team_short   TEXT,
  str_sport        TEXT,
  id_league        INT REFERENCES tsdb.league(id_league),
  str_division     TEXT,
  int_formed_year  INT,
  id_venue         TEXT,
  str_stadium      TEXT,
  int_capacity     INT,
  str_location     TEXT,
  str_country      TEXT,
  str_colour1      TEXT,
  str_colour2      TEXT,
  str_colour3      TEXT,
  -- Cross-source IDs. Useful for joining to Rolling Insights / nflverse.
  id_espn          TEXT,
  id_apifootball   TEXT,
  canonical_team_id UUID,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX tsdb_team_league_idx    ON tsdb.team (id_league);
CREATE INDEX tsdb_team_canonical_idx ON tsdb.team (canonical_team_id);

CREATE TABLE tsdb.player (
  id_player        TEXT PRIMARY KEY,
  str_player       TEXT,
  str_player_alt   TEXT,
  id_team          TEXT REFERENCES tsdb.team(id_team),
  str_sport        TEXT,
  str_position     TEXT,
  str_number       TEXT,
  date_born        DATE,
  date_died        DATE,
  str_nationality  TEXT,
  str_birth_location TEXT,
  str_college      TEXT,
  str_height       TEXT,
  str_weight       TEXT,
  str_status       TEXT,
  str_gender       TEXT,
  -- ⚠️ THE license signal. Gate headshot display on this. Player objects only.
  str_creative_commons TEXT,
  id_espn          TEXT,
  id_apifootball   TEXT,
  id_wikidata      TEXT,
  id_transfermkt   TEXT,
  canonical_player_id UUID,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX tsdb_player_team_idx      ON tsdb.player (id_team);
CREATE INDEX tsdb_player_canonical_idx ON tsdb.player (canonical_player_id);
CREATE INDEX tsdb_player_name_idx      ON tsdb.player (lower(str_player));

CREATE TABLE tsdb.venue (
  id_venue        TEXT PRIMARY KEY,
  str_venue       TEXT,
  str_venue_alt   TEXT,
  str_sport       TEXT,
  int_capacity    INT,
  str_country     TEXT,
  str_location    TEXT,
  str_timezone    TEXT,
  int_formed_year INT,
  str_architect   TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- L2 — MEDIA ASSETS  (the licensing gate lives here)
-- ============================================================================
-- Rights decision is made ONCE at ingestion, not scattered through UI code.
CREATE TABLE tsdb.media_asset (
  id            BIGSERIAL PRIMARY KEY,
  kind          tsdb.media_kind NOT NULL,
  owner_type    TEXT NOT NULL,          -- 'team' | 'player' | 'league' | 'event' | 'venue'
  owner_id      TEXT NOT NULL,
  url_original  TEXT NOT NULL,
  url_medium    TEXT GENERATED ALWAYS AS (url_original || '/medium') STORED,
  url_small     TEXT GENERATED ALWAYS AS (url_original || '/small')  STORED,
  url_tiny      TEXT GENERATED ALWAYS AS (url_original || '/tiny')   STORED,
  -- ⚠️ Two CDN hosts appear in the SAME response. Normalize at ingestion.
  cdn_host      TEXT NOT NULL CHECK (cdn_host IN ('r2.thesportsdb.com','www.thesportsdb.com')),
  rights        tsdb.media_rights NOT NULL DEFAULT 'UNKNOWN',
  cc_licensed   BOOLEAN,                -- from player.strCreativeCommons == 'Yes'
  -- The only column the UI should read.
  display_allowed BOOLEAN NOT NULL DEFAULT false,
  blocked_reason TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_type, owner_id, kind)
);

CREATE INDEX tsdb_media_displayable_idx
  ON tsdb.media_asset (owner_type, owner_id) WHERE display_allowed = true;

-- ⚠ 2026-08-18: THIS GATE WAS NEVER BUILT, AND SHOULD NOT BE.
-- The owner's counsel cleared displaying player headshots (GAPS.md G-03), and
-- this file is a design document -- there is no `tsdb` schema in Prisma and no
-- migration behind it. `display_allowed` has never gated anything in the running
-- system. Implementing it now would block images that are cleared to show.
-- What IS still binding is attribution, and the ban on modifying team badges and
-- league logos. Neither is a per-asset boolean.
COMMENT ON COLUMN tsdb.media_asset.display_allowed IS
  'THE ONLY column UI code should read. Policy (see README.md): '
  'true for team/league badges and logos (TRADEMARK_ASIS, unmodified display only); '
  'true for player art ONLY where cc_licensed = true; '
  'false for everything UNKNOWN. Never display an UNKNOWN asset. '
  'Modification of TRADEMARK_ASIS assets is forbidden by vendor terms.';

-- Enforce the policy in the database rather than trusting application code.
CREATE OR REPLACE FUNCTION tsdb.apply_media_rights() RETURNS trigger AS $$
BEGIN
  IF NEW.rights = 'BLOCKED' THEN
    NEW.display_allowed := false;
  ELSIF NEW.owner_type = 'player' THEN
    NEW.rights          := CASE WHEN NEW.cc_licensed THEN 'CC_LICENSED' ELSE 'UNKNOWN' END;
    NEW.display_allowed := COALESCE(NEW.cc_licensed, false);
  ELSIF NEW.kind IN ('team_badge','team_logo','league_badge','league_logo') THEN
    NEW.rights          := 'TRADEMARK_ASIS';
    NEW.display_allowed := true;         -- unmodified display only
  ELSE
    NEW.rights          := 'UNKNOWN';
    NEW.display_allowed := false;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER tsdb_media_rights_trg
  BEFORE INSERT OR UPDATE ON tsdb.media_asset
  FOR EACH ROW EXECUTE FUNCTION tsdb.apply_media_rights();

-- ============================================================================
-- L2 — EVENTS / SCHEDULE
-- ============================================================================
CREATE TABLE tsdb.event (
  id_event        TEXT PRIMARY KEY,
  str_event       TEXT,
  str_filename    TEXT,
  str_sport       TEXT,
  id_league       INT REFERENCES tsdb.league(id_league),
  str_season      TEXT,
  int_round       INT,          -- see enums: 500=preseason, 200=final, etc.
  id_home_team    TEXT,
  id_away_team    TEXT,
  int_home_score  INT,
  int_away_score  INT,
  int_home_score_extra INT,     -- OT
  int_away_score_extra INT,
  str_status      TEXT,         -- American Football: NS,Q1..Q4,OT,HT,FT,AOT,CANC,PST
  str_postponed   TEXT,
  date_event      DATE,
  date_event_local DATE,
  str_time        TEXT,
  str_time_local  TEXT,
  str_timestamp   TIMESTAMPTZ,
  id_venue        TEXT,
  str_venue       TEXT,
  str_city        TEXT,
  str_weather     TEXT,
  str_official    TEXT,
  int_spectators  INT,
  -- ⚠️ HTML-embedded quarter scores. Brittle. Prefer Rolling Insights.
  str_result_raw  TEXT,
  quarter_scores  JSONB,        -- best-effort parse of str_result_raw; NULL if unparseable
  -- YouTube highlight URL. The legitimate highlight path (see live-gameday spec).
  str_video       TEXT,
  str_locked      TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX tsdb_event_date_idx   ON tsdb.event (date_event, id_league);
CREATE INDEX tsdb_event_league_idx ON tsdb.event (id_league, str_season);
CREATE INDEX tsdb_event_video_idx  ON tsdb.event (id_event) WHERE str_video IS NOT NULL;

COMMENT ON COLUMN tsdb.event.quarter_scores IS
  'Best-effort parse of str_result_raw, which is an HTML string like '
  '"Quarter 1:<br>7 7 <br>Quarter 2<br>14 13 <br>...". Whitespace is inconsistent '
  'between records and there are no per-quarter integer fields. NULL when parsing '
  'fails — never fabricate. Prefer Rolling Insights for authoritative quarter scores.';

-- ---------------------------------------------------------------------------
-- Livescore. 2-minute BATCH snapshot, not push. Scores only — no player stats.
-- ---------------------------------------------------------------------------
CREATE TABLE tsdb.livescore (
  id_event        TEXT PRIMARY KEY,
  str_sport       TEXT,
  id_league       INT,
  id_home_team    TEXT,
  id_away_team    TEXT,
  int_home_score  INT,
  int_away_score  INT,
  str_status      TEXT,
  str_progress    TEXT,         -- AmFootball: 'mm:ss - Xst/nd/rd/th' OR 'Final'
  str_event_time  TEXT,
  date_event      DATE,
  -- Vendor's own staleness marker. Poll THIS rather than trusting the interval.
  vendor_updated  TIMESTAMPTZ,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE tsdb.livescore IS
  '2-minute batch refresh. Every row in a response shares an identical vendor_updated '
  'value — this is a whole-feed snapshot on a timer, not per-event updates. Scores only. '
  'Cannot drive fantasy scoring or play-level alerts. Rolling Insights /live is the '
  'authoritative game-day source; this is a cheap cross-check and a fallback.';

-- ---------------------------------------------------------------------------
-- Season-level player stats. Generic key/value. NO weekly/per-game data.
-- ---------------------------------------------------------------------------
CREATE TABLE tsdb.player_season_stat (
  id_player     TEXT NOT NULL REFERENCES tsdb.player(id_player),
  str_season    TEXT NOT NULL,
  id_league     INT,
  str_statistic TEXT NOT NULL,
  str_value     TEXT,
  num_value     NUMERIC,        -- parsed where possible
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id_player, str_season, str_statistic)
);

COMMENT ON TABLE tsdb.player_season_stat IS
  'SEASON AGGREGATES ONLY. Verified working for NFL (e.g. Passing Yards, Passing '
  'Touchdowns, Rushing Yards). Duplicate rows across seasons have been observed — '
  'dedupe on the PK. Per-position coverage unverified. Never use for weekly scoring.';

-- ---------------------------------------------------------------------------
-- TV listings — genuinely unique to this source
-- ---------------------------------------------------------------------------
CREATE TABLE tsdb.event_tv (
  id_event    TEXT NOT NULL,
  id_channel  TEXT,
  str_channel TEXT,
  str_country TEXT,
  date_event  DATE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id_event, str_channel, str_country)
);

CREATE INDEX tsdb_event_tv_date_idx ON tsdb.event_tv (date_event, str_country);

-- ============================================================================
-- POLLING SCHEDULE  (slow — this is reference data, not a live feed)
-- ============================================================================
CREATE TABLE tsdb.poll_job (
  id           BIGSERIAL PRIMARY KEY,
  api_version  SMALLINT NOT NULL,
  endpoint     TEXT     NOT NULL,
  args         JSONB    NOT NULL DEFAULT '{}',
  interval_sec INT      NOT NULL,
  next_run_at  TIMESTAMPTZ NOT NULL,
  last_run_at  TIMESTAMPTZ,
  last_status  INT,
  last_hash    TEXT,
  enabled      BOOLEAN  NOT NULL DEFAULT true,
  UNIQUE (api_version, endpoint, args)
);

CREATE INDEX tsdb_poll_due_idx ON tsdb.poll_job (next_run_at) WHERE enabled = true;

-- Recommended cadence. Note how little of this is game-day.
--   livescore/{idLeague} .......... 120s  (matches the 2-min batch; faster is wasted)
--   eventsday ..................... 1/hour on game days, else 1/day
--   eventsseason .................. 1/day
--   lookupteam / search_all_teams . 1/week
--   lookup_all_players ............ 1/week
--   lookupplayerstats ............. 1/week (season aggregates change slowly)
--   eventstv ...................... 1/day
--   eventshighlights .............. 1/hour for ~6h post-game, then stop
--   lookupvenue / lookupleague .... 1/month
--
-- At 100 rpm (premium) this is nowhere near the cap. Rate limiting is not a
-- constraint for this source — its value is breadth of metadata, not freshness.

-- ============================================================================
-- APP-FACING VIEWS
-- ============================================================================

-- Only displayable media. UI must query THIS, never media_asset directly.
CREATE VIEW tsdb.v_team_media AS
SELECT t.id_team, t.str_team, t.canonical_team_id,
       max(CASE WHEN m.kind = 'team_badge' THEN m.url_original END) AS badge_url,
       max(CASE WHEN m.kind = 'team_logo'  THEN m.url_original END) AS logo_url,
       max(CASE WHEN m.kind = 'team_badge' THEN m.url_small    END) AS badge_small
FROM tsdb.team t
LEFT JOIN tsdb.media_asset m
       ON m.owner_type = 'team' AND m.owner_id = t.id_team AND m.display_allowed
GROUP BY t.id_team, t.str_team, t.canonical_team_id;

CREATE VIEW tsdb.v_player_media AS
SELECT p.id_player, p.str_player, p.canonical_player_id,
       m.url_original, m.url_small, m.kind
FROM tsdb.player p
JOIN tsdb.media_asset m
  ON m.owner_type = 'player' AND m.owner_id = p.id_player
WHERE m.display_allowed = true;   -- i.e. cc_licensed only

CREATE VIEW tsdb.v_upcoming_broadcasts AS
SELECT e.id_event, e.str_event, e.date_event, e.str_time,
       l.str_league, tv.str_channel, tv.str_country
FROM tsdb.event e
JOIN tsdb.event_tv tv ON tv.id_event = e.id_event
LEFT JOIN tsdb.league l ON l.id_league = e.id_league
WHERE e.date_event >= current_date
ORDER BY e.date_event, e.str_time;

CREATE VIEW tsdb.v_event_highlights AS
SELECT id_event, str_event, date_event, id_league, str_video
FROM tsdb.event
WHERE str_video IS NOT NULL AND str_video <> ''
ORDER BY date_event DESC;

COMMENT ON VIEW tsdb.v_event_highlights IS
  'Game-level YouTube highlight links (NOT per-play). This is the legitimate '
  'highlight path per the live-gameday spec: YouTube embeds. Verify status.embeddable '
  'via the YouTube Data API before rendering a player, and respect YouTube Developer '
  'Policies — no paywalling, no overlays, no clipping, no ads on the player. '
  'Vendor warns some videos are geo-locked.';
