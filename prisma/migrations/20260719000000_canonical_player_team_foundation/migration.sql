-- Canonical Player/Team foundation.
--
-- Brings production in line with the `Player` and `sports_core_*` models that `schema.prisma`
-- already declares, so the canonical read path (Phases 1-3) has tables to run against.
--
-- SCOPE: additive only. Generated with `prisma migrate diff` against a clone of production and
-- then deliberately narrowed. The UNSCOPED diff also wanted to DROP columns that exist in
-- production but not in schema.prisma -- playoff_bracket_entries.correct_picks / total_score /
-- is_locked / rank / submitted_at, playoff_bracket_picks.is_correct / points_awarded,
-- playoff_bracket_series.home_wins / away_wins, draft_sessions.seasonYear, and the
-- ai_interaction_logs primary key. Those are real production data and are NOT touched here.
-- Do NOT regenerate this file with a bare `prisma migrate dev` or `prisma db push` against
-- production; 88 unrelated drift statements remain and are intentionally out of scope.
--
-- RISK: low. `Player` holds 0 rows in production (verified 2026-07-19), so the ALTER is
-- additive against an empty table. All eight sports_core_* tables are new.
--
-- This also repairs three code paths that throw in production TODAY. Bare `prisma.player.find*`
-- calls request every column the model declares, and production is missing 17 of them:
--   lib/devy/identityMatchingEngine.ts:178
--   lib/devy/mergeExecutionEngine.ts:114
--   app/api/devy/automation/route.ts:34
-- Confirmed against production: SELECT normalized_name FROM "Player" -> column does not exist.

-- 1. Add the 17 canonical columns to Player (additive; no drops).
ALTER TABLE "Player" ADD COLUMN     "birth_date" TIMESTAMP(3),
ADD COLUMN     "canonical_slug" TEXT,
ADD COLUMN     "confidence" DOUBLE PRECISION,
ADD COLUMN     "current_team_id" TEXT,
ADD COLUMN     "expires_at" TIMESTAMP(3),
ADD COLUMN     "fetched_at" TIMESTAMP(3),
ADD COLUMN     "height" TEXT,
ADD COLUMN     "image_url" TEXT,
ADD COLUMN     "last_seen_at" TIMESTAMP(3),
ADD COLUMN     "nationality" TEXT,
ADD COLUMN     "normalized_name" TEXT,
ADD COLUMN     "provider_ids" JSONB,
ADD COLUMN     "raw_payload" JSONB,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "source_updated_at" TIMESTAMP(3),
ADD COLUMN     "sport_league_key" TEXT,
ADD COLUMN     "weight" TEXT;

-- 2. The eight canonical sports_core_* tables. The write path needs teams / images /
--    provider identities; getCanonicalPlayer() additionally reads season stats, news and
--    injury reports, which an earlier scoping pass missed and end-to-end testing caught.
CREATE TABLE "sports_core_teams" (
    "id" TEXT NOT NULL,
    "sport_key" VARCHAR(32) NOT NULL,
    "league_key" VARCHAR(64),
    "season_key" VARCHAR(32),
    "canonical_name" VARCHAR(160) NOT NULL,
    "normalized_name" VARCHAR(160) NOT NULL,
    "short_name" VARCHAR(80),
    "abbreviation" VARCHAR(24),
    "city" VARCHAR(96),
    "country" VARCHAR(96),
    "fifa_code" VARCHAR(8),
    "conference" VARCHAR(64),
    "division" VARCHAR(64),
    "confederation" VARCHAR(32),
    "colors" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "source" VARCHAR(64),
    "confidence" DOUBLE PRECISION,
    "fetched_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "source_updated_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "raw_payload" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sports_core_teams_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sports_core_team_provider_identities" (
    "id" TEXT NOT NULL,
    "team_id" VARCHAR(128),
    "sport_key" VARCHAR(32) NOT NULL,
    "league_key" VARCHAR(64),
    "provider" VARCHAR(64) NOT NULL,
    "provider_team_id" VARCHAR(128) NOT NULL,
    "provider_slug" VARCHAR(160),
    "display_name" VARCHAR(160),
    "aliases" JSONB,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "source" VARCHAR(64),
    "source_updated_at" TIMESTAMP(3),
    "fetched_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "raw_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sports_core_team_provider_identities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sports_core_team_images" (
    "id" TEXT NOT NULL,
    "team_id" VARCHAR(128),
    "sport_key" VARCHAR(32) NOT NULL,
    "league_key" VARCHAR(64),
    "image_type" VARCHAR(32) NOT NULL,
    "url" TEXT NOT NULL,
    "provider" VARCHAR(64),
    "width" INTEGER,
    "height" INTEGER,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION,
    "fetched_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "source_updated_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "raw_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sports_core_team_images_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sports_core_player_provider_identities" (
    "id" TEXT NOT NULL,
    "player_id" VARCHAR(128),
    "sport_key" VARCHAR(32) NOT NULL,
    "league_key" VARCHAR(64),
    "provider" VARCHAR(64) NOT NULL,
    "provider_player_id" VARCHAR(128) NOT NULL,
    "provider_slug" VARCHAR(160),
    "display_name" VARCHAR(160),
    "team_id" VARCHAR(128),
    "aliases" JSONB,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "source" VARCHAR(64),
    "source_updated_at" TIMESTAMP(3),
    "fetched_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "raw_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sports_core_player_provider_identities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sports_core_player_images" (
    "id" TEXT NOT NULL,
    "player_id" VARCHAR(128),
    "sport_key" VARCHAR(32) NOT NULL,
    "league_key" VARCHAR(64),
    "image_type" VARCHAR(32) NOT NULL,
    "url" TEXT NOT NULL,
    "provider" VARCHAR(64),
    "width" INTEGER,
    "height" INTEGER,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION,
    "fetched_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "source_updated_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "raw_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sports_core_player_images_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sports_core_player_season_stats" (
    "id" TEXT NOT NULL,
    "player_id" VARCHAR(128) NOT NULL,
    "sport_key" VARCHAR(32) NOT NULL,
    "league_key" VARCHAR(64),
    "team_id" VARCHAR(128),
    "season_key" VARCHAR(32) NOT NULL,
    "season_type" VARCHAR(32) NOT NULL DEFAULT 'regular',
    "position" VARCHAR(32),
    "stats" JSONB NOT NULL,
    "fantasy_points" DOUBLE PRECISION,
    "games_played" INTEGER,
    "source" VARCHAR(64),
    "confidence" DOUBLE PRECISION,
    "fetched_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "source_updated_at" TIMESTAMP(3),
    "raw_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sports_core_player_season_stats_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sports_core_player_news_items" (
    "id" TEXT NOT NULL,
    "player_id" VARCHAR(128),
    "team_id" VARCHAR(128),
    "sport_key" VARCHAR(32) NOT NULL,
    "league_key" VARCHAR(64),
    "headline" VARCHAR(512) NOT NULL,
    "body" TEXT,
    "url" TEXT,
    "category" VARCHAR(64),
    "source" VARCHAR(96),
    "author" VARCHAR(128),
    "published_at" TIMESTAMP(3),
    "fetched_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION,
    "identity_confidence" DOUBLE PRECISION,
    "sentiment" VARCHAR(32),
    "raw_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sports_core_player_news_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sports_core_injury_reports" (
    "id" TEXT NOT NULL,
    "player_id" VARCHAR(128),
    "team_id" VARCHAR(128),
    "sport_key" VARCHAR(32) NOT NULL,
    "league_key" VARCHAR(64),
    "season_key" VARCHAR(32),
    "week_or_round" VARCHAR(64),
    "player_name" VARCHAR(160) NOT NULL,
    "team_name" VARCHAR(160),
    "status" VARCHAR(64),
    "practice_status" VARCHAR(64),
    "game_status" VARCHAR(64),
    "body_part" VARCHAR(96),
    "description" TEXT,
    "report_date" TIMESTAMP(3),
    "source" VARCHAR(64),
    "confidence" DOUBLE PRECISION,
    "identity_confidence" DOUBLE PRECISION,
    "fetched_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "source_updated_at" TIMESTAMP(3),
    "raw_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sports_core_injury_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sports_core_teams_sport_key_league_key_idx" ON "sports_core_teams"("sport_key", "league_key");
CREATE INDEX "sports_core_teams_sport_key_abbreviation_idx" ON "sports_core_teams"("sport_key", "abbreviation");
CREATE INDEX "sports_core_teams_country_idx" ON "sports_core_teams"("country");
CREATE INDEX "sports_core_teams_fifa_code_idx" ON "sports_core_teams"("fifa_code");
CREATE INDEX "sports_core_teams_fetched_at_idx" ON "sports_core_teams"("fetched_at");
CREATE INDEX "sports_core_teams_expires_at_idx" ON "sports_core_teams"("expires_at");
CREATE UNIQUE INDEX "sports_core_teams_sport_key_league_key_normalized_name_key" ON "sports_core_teams"("sport_key", "league_key", "normalized_name");
CREATE INDEX "sports_core_team_provider_identities_team_id_idx" ON "sports_core_team_provider_identities"("team_id");
CREATE INDEX "sports_core_team_provider_identities_sport_key_league_key_idx" ON "sports_core_team_provider_identities"("sport_key", "league_key");
CREATE INDEX "sports_core_team_provider_identities_provider_provider_team_idx" ON "sports_core_team_provider_identities"("provider", "provider_team_id");
CREATE INDEX "sports_core_team_provider_identities_confidence_idx" ON "sports_core_team_provider_identities"("confidence");
CREATE UNIQUE INDEX "sports_core_team_provider_identities_provider_sport_key_lea_key" ON "sports_core_team_provider_identities"("provider", "sport_key", "league_key", "provider_team_id");
CREATE INDEX "sports_core_team_images_sport_key_league_key_idx" ON "sports_core_team_images"("sport_key", "league_key");
CREATE INDEX "sports_core_team_images_image_type_is_primary_idx" ON "sports_core_team_images"("image_type", "is_primary");
CREATE INDEX "sports_core_team_images_fetched_at_idx" ON "sports_core_team_images"("fetched_at");
CREATE UNIQUE INDEX "sports_core_team_images_team_id_image_type_url_key" ON "sports_core_team_images"("team_id", "image_type", "url");
CREATE INDEX "sports_core_player_provider_identities_player_id_idx" ON "sports_core_player_provider_identities"("player_id");
CREATE INDEX "sports_core_player_provider_identities_team_id_idx" ON "sports_core_player_provider_identities"("team_id");
CREATE INDEX "sports_core_player_provider_identities_sport_key_league_key_idx" ON "sports_core_player_provider_identities"("sport_key", "league_key");
CREATE INDEX "sports_core_player_provider_identities_provider_provider_pl_idx" ON "sports_core_player_provider_identities"("provider", "provider_player_id");
CREATE INDEX "sports_core_player_provider_identities_confidence_idx" ON "sports_core_player_provider_identities"("confidence");
CREATE UNIQUE INDEX "sports_core_player_provider_identities_provider_sport_key_l_key" ON "sports_core_player_provider_identities"("provider", "sport_key", "league_key", "provider_player_id");
CREATE INDEX "sports_core_player_images_sport_key_league_key_idx" ON "sports_core_player_images"("sport_key", "league_key");
CREATE INDEX "sports_core_player_images_image_type_is_primary_idx" ON "sports_core_player_images"("image_type", "is_primary");
CREATE INDEX "sports_core_player_images_fetched_at_idx" ON "sports_core_player_images"("fetched_at");
CREATE UNIQUE INDEX "sports_core_player_images_player_id_image_type_url_key" ON "sports_core_player_images"("player_id", "image_type", "url");
CREATE INDEX "sports_core_player_season_stats_sport_key_league_key_season_idx" ON "sports_core_player_season_stats"("sport_key", "league_key", "season_key");
CREATE INDEX "sports_core_player_season_stats_team_id_idx" ON "sports_core_player_season_stats"("team_id");
CREATE INDEX "sports_core_player_season_stats_fetched_at_idx" ON "sports_core_player_season_stats"("fetched_at");
CREATE UNIQUE INDEX "sports_core_player_season_stats_player_id_sport_key_season__key" ON "sports_core_player_season_stats"("player_id", "sport_key", "season_key", "season_type", "source");
CREATE INDEX "sports_core_injury_reports_sport_key_league_key_report_date_idx" ON "sports_core_injury_reports"("sport_key", "league_key", "report_date");
CREATE INDEX "sports_core_injury_reports_player_id_report_date_idx" ON "sports_core_injury_reports"("player_id", "report_date");
CREATE INDEX "sports_core_injury_reports_team_id_report_date_idx" ON "sports_core_injury_reports"("team_id", "report_date");
CREATE INDEX "sports_core_injury_reports_status_idx" ON "sports_core_injury_reports"("status");
CREATE INDEX "sports_core_injury_reports_expires_at_idx" ON "sports_core_injury_reports"("expires_at");
CREATE INDEX "sports_core_player_news_items_sport_key_league_key_publishe_idx" ON "sports_core_player_news_items"("sport_key", "league_key", "published_at");
CREATE INDEX "sports_core_player_news_items_player_id_published_at_idx" ON "sports_core_player_news_items"("player_id", "published_at");
CREATE INDEX "sports_core_player_news_items_team_id_published_at_idx" ON "sports_core_player_news_items"("team_id", "published_at");
CREATE INDEX "sports_core_player_news_items_category_published_at_idx" ON "sports_core_player_news_items"("category", "published_at");
CREATE INDEX "sports_core_player_news_items_expires_at_idx" ON "sports_core_player_news_items"("expires_at");
-- 3. Partial unique index required by the batched backfill.
--    `uniq_player_provider_identity` spans the nullable `league_key`, and Postgres does not
--    treat NULLs as conflicting, so a plain ON CONFLICT never fires for league-agnostic rows
--    and the backfill could not be idempotent without this.
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_ppi_provider_sport_pid_null_league"
  ON "sports_core_player_provider_identities" ("provider", "sport_key", "provider_player_id")
  WHERE "league_key" IS NULL;
