-- Reconstruct the schema objects of four migrations that production applied on 2026-06-10 but whose
-- files were never committed and cannot be recovered.
--
-- WHY THIS EXISTS
-- Production's _prisma_migrations records these as applied (2026-06-10 05:25 UTC, one step each):
--   20260609010000_add_ai_billing_fields          checksum 36da42092e790665…
--   20260610090000_add_fantasy_cache_contracts    checksum e4fad56041ced25c…
--   20260610091000_add_concept_presets            checksum 12bd7f34e4301e7c…
--   20260610100000_expand_concept_presets         checksum f001afc238c79451…
-- Their schema.prisma changes landed in 8d40c1e58 (2026-06-10); the four migration folders did not.
-- On 2026-10-01 every copy was searched for and none found: 156 worktrees across both clones, both
-- clones' stashes, 2,237 unreachable git blobs hashed against the checksums above, and a disk-wide
-- folder search. So the originals are gone, and a database built from migration history alone — the
-- documented way — has none of the objects below. Same failure class as
-- 20260717070000_backfill_missing_schema_objects, and the same shape of fix.
--
-- THIS IS NOT THOSE FOUR MIGRATIONS
-- It does not reuse their names, so it cannot be mistaken for them and does not collide with their
-- rows in _prisma_migrations. Its content can never match their checksums. It reproduces what they
-- LEFT, not what they said; in particular the boundary between add_concept_presets and
-- expand_concept_presets is inferred from production's column order (attnum 1–21 vs 22–32) and is
-- kept below only as section headings.
--
-- SOURCE OF TRUTH
-- Every column type, nullability, default, index and constraint below was read on 2026-10-01 from
-- PRODUCTION's catalogs (pg_attribute, pg_attrdef, pg_constraint, pg_indexes) — not inferred from the
-- Prisma models. Where the two disagree, production wins, because production is what this restores:
--   ⚠ concept_presets_preset_key_key is a PARTIAL unique index (WHERE preset_key IS NOT NULL);
--     ConceptPreset.presetKey's @unique describes a plain one. Pre-existing, unchanged here.
--   ⚠ Several defaults (e.g. '{}'::jsonb on roster_slots, now() on updated_at) exist in production
--     but not in the models. Also pre-existing, also reproduced as production has them.
-- No foreign keys reference or leave these tables. No CHECKs, triggers, RLS, policies or comments.
--
-- SAFETY / IDEMPOTENCY
-- Every statement is IF NOT EXISTS. On production, and on any database that already has these
-- objects, this is a NO-OP: it creates nothing, drops nothing and rewrites no data. On a
-- migration-built database it creates exactly the objects below.
--
-- SCOPE — deliberately narrow
-- Only what those four migrations created. ~19 other schema tables also have no creating migration
-- (db-push era: ai_opponent_*, league_finance, payout_*, …). That is a separate reconciliation; do not
-- widen this file.

-- ── 20260609010000_add_ai_billing_fields ─────────────────────────────────────────────────────────────
ALTER TABLE "ai_interaction_logs" ADD COLUMN IF NOT EXISTS "billingReason" VARCHAR(32);
ALTER TABLE "ai_interaction_logs" ADD COLUMN IF NOT EXISTS "shouldChargeToken" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ai_interaction_logs" ADD COLUMN IF NOT EXISTS "tokenCharged" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ai_interaction_logs" ADD COLUMN IF NOT EXISTS "tokenChargeStatus" VARCHAR(32);
CREATE INDEX IF NOT EXISTS "ai_interaction_logs_shouldChargeToken_createdAt_idx" ON "ai_interaction_logs" ("shouldChargeToken", "createdAt");
CREATE INDEX IF NOT EXISTS "ai_interaction_logs_tokenCharged_createdAt_idx" ON "ai_interaction_logs" ("tokenCharged", "createdAt");

-- ── 20260610090000_add_fantasy_cache_contracts ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "fantasy_projections" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "scoring_preset_id" TEXT NOT NULL,
    "projected_points" DOUBLE PRECISION NOT NULL,
    "stats" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "source" TEXT NOT NULL,
    "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "fantasy_projections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_fantasy_projection_player_week_scoring_source" ON "fantasy_projections" ("player_id", "sport", "season", "week", "scoring_preset_id", "source");
CREATE INDEX IF NOT EXISTS "fantasy_projections_sport_season_week_idx" ON "fantasy_projections" ("sport", "season", "week");
CREATE INDEX IF NOT EXISTS "fantasy_projections_player_id_idx" ON "fantasy_projections" ("player_id");
CREATE INDEX IF NOT EXISTS "fantasy_projections_source_idx" ON "fantasy_projections" ("source");
CREATE INDEX IF NOT EXISTS "fantasy_projections_expires_at_idx" ON "fantasy_projections" ("expires_at");

CREATE TABLE IF NOT EXISTS "fantasy_stat_lines" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "team" TEXT,
    "opponent" TEXT,
    "stats" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "fantasy_points_by_scoring_preset" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "source" TEXT NOT NULL,
    "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "fantasy_stat_lines_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_fantasy_stat_line_player_week_source" ON "fantasy_stat_lines" ("player_id", "sport", "season", "week", "source");
CREATE INDEX IF NOT EXISTS "fantasy_stat_lines_sport_season_week_idx" ON "fantasy_stat_lines" ("sport", "season", "week");
CREATE INDEX IF NOT EXISTS "fantasy_stat_lines_player_id_idx" ON "fantasy_stat_lines" ("player_id");
CREATE INDEX IF NOT EXISTS "fantasy_stat_lines_team_idx" ON "fantasy_stat_lines" ("team");
CREATE INDEX IF NOT EXISTS "fantasy_stat_lines_source_idx" ON "fantasy_stat_lines" ("source");
CREATE INDEX IF NOT EXISTS "fantasy_stat_lines_expires_at_idx" ON "fantasy_stat_lines" ("expires_at");

CREATE TABLE IF NOT EXISTS "fantasy_schedule_games" (
    "id" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "home_team" TEXT NOT NULL,
    "away_team" TEXT NOT NULL,
    "kickoff_time" TIMESTAMPTZ,
    "status" TEXT,
    "score" JSONB,
    "provider_game_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "fantasy_schedule_games_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_fantasy_schedule_game_provider" ON "fantasy_schedule_games" ("sport", "provider_game_id", "source");
CREATE INDEX IF NOT EXISTS "fantasy_schedule_games_sport_season_week_idx" ON "fantasy_schedule_games" ("sport", "season", "week");
CREATE INDEX IF NOT EXISTS "fantasy_schedule_games_home_team_idx" ON "fantasy_schedule_games" ("home_team");
CREATE INDEX IF NOT EXISTS "fantasy_schedule_games_away_team_idx" ON "fantasy_schedule_games" ("away_team");
CREATE INDEX IF NOT EXISTS "fantasy_schedule_games_source_idx" ON "fantasy_schedule_games" ("source");
CREATE INDEX IF NOT EXISTS "fantasy_schedule_games_expires_at_idx" ON "fantasy_schedule_games" ("expires_at");

-- ── 20260610091000_add_concept_presets (production attnum 1–21) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "concept_presets" (
    "id" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "league_type" TEXT NOT NULL,
    "draft_types_allowed" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "default_team_count" INTEGER NOT NULL,
    "roster_slots" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "bench_slots" INTEGER NOT NULL DEFAULT 0,
    "ir_slots" INTEGER NOT NULL DEFAULT 0,
    "taxi_slots" INTEGER NOT NULL DEFAULT 0,
    "scoring_preset" TEXT NOT NULL,
    "waiver_rules" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "trade_rules" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "playoff_rules" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "schedule_rules" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "draft_rules" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "ai_enabled_features" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "required_data_feeds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "source" TEXT NOT NULL DEFAULT 'allfantasy',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "concept_presets_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "concept_presets_sport_league_type_idx" ON "concept_presets" ("sport", "league_type");
CREATE INDEX IF NOT EXISTS "concept_presets_sport_idx" ON "concept_presets" ("sport");
CREATE INDEX IF NOT EXISTS "concept_presets_league_type_idx" ON "concept_presets" ("league_type");
CREATE INDEX IF NOT EXISTS "concept_presets_active_idx" ON "concept_presets" ("active");

-- ── 20260610100000_expand_concept_presets (production attnum 22–32) ──────────────────────────────────
ALTER TABLE "concept_presets" ADD COLUMN IF NOT EXISTS "preset_key" TEXT;
ALTER TABLE "concept_presets" ADD COLUMN IF NOT EXISTS "readiness" TEXT NOT NULL DEFAULT 'coming_soon';
ALTER TABLE "concept_presets" ADD COLUMN IF NOT EXISTS "visibility" TEXT NOT NULL DEFAULT 'hidden';
ALTER TABLE "concept_presets" ADD COLUMN IF NOT EXISTS "is_launch_ready" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "concept_presets" ADD COLUMN IF NOT EXISTS "feature_flag_key" TEXT;
ALTER TABLE "concept_presets" ADD COLUMN IF NOT EXISTS "marketing_label" TEXT;
ALTER TABLE "concept_presets" ADD COLUMN IF NOT EXISTS "short_description" TEXT;
ALTER TABLE "concept_presets" ADD COLUMN IF NOT EXISTS "commissioner_warning" TEXT;
ALTER TABLE "concept_presets" ADD COLUMN IF NOT EXISTS "user_facing_warning" TEXT;
ALTER TABLE "concept_presets" ADD COLUMN IF NOT EXISTS "unsupported_reason" TEXT;
ALTER TABLE "concept_presets" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS "concept_presets_preset_key_key" ON "concept_presets" ("preset_key") WHERE "preset_key" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "concept_presets_readiness_idx" ON "concept_presets" ("readiness");
CREATE INDEX IF NOT EXISTS "concept_presets_visibility_idx" ON "concept_presets" ("visibility");
