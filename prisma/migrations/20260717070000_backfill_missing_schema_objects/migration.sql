-- Backfill schema objects that exist in prisma/schema.prisma (and in every db-push'd database,
-- including production) but were NEVER represented in migration history.
--
-- WHY THIS EXISTS
-- `user_profiles.chimmy_tts_voice_id` was added to schema.prisma by commit bbf01264f (2026-04-06)
-- with ZERO accompanying migration; `fantasy_players` likewise appears in no migration file at all.
-- Databases reconciled with `prisma db push` (production among them) have both. Databases built the
-- documented way -- `prisma migrate deploy` -- do NOT, and then break: `prisma.userProfile.upsert()`
-- selects every mapped column, so the missing column makes Prisma throw inside NextAuth's
-- authorize(), which returns 401. i.e. authentication is broken on any migration-built database.
-- See docs/LOCAL_VERIFICATION_ENVIRONMENT.md section 7b.
--
-- SAFETY / IDEMPOTENCY
-- Every statement is IF NOT EXISTS. On a database that already has these objects (production, and any
-- db-push'd dev branch) this migration is a verified NO-OP: it adds nothing, drops nothing, and
-- rewrites no data. On a migration-built database it creates exactly the two missing pieces.
--
-- SCOPE -- deliberately narrow
-- This covers ONLY the two objects confirmed missing by direct verification against migration
-- history. It is NOT an attempt to reconcile the full history (66 models were flagged by a
-- repo-wide scan). That reconciliation is a separate, unscoped project; do not widen this file.
--
-- Column list, types, defaults, nullability and indexes below were read directly out of a live
-- database's information_schema/pg_indexes -- not inferred from the Prisma model.

-- 1) user_profiles.chimmy_tts_voice_id -- backs the live Chimmy TTS voice picker
--    (/api/user/profile <- useChimmyTtsVoiceSync <- ChimmyVoiceSettingsCard at /settings).
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "chimmy_tts_voice_id" TEXT;

-- 2) fantasy_players -- absent from migration history entirely.
CREATE TABLE IF NOT EXISTS "fantasy_players" (
    "id" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "provider_ids" JSONB NOT NULL,
    "full_name" TEXT NOT NULL,
    "team" TEXT,
    "college_team" TEXT,
    "position" TEXT,
    "fantasy_positions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "headshot_url" TEXT,
    "status" TEXT,
    "injury_status" TEXT,
    "bye_week" INTEGER,
    "depth_chart_position" TEXT,
    "source" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fantasy_players_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "fantasy_players_sport_full_name_idx" ON "fantasy_players"("sport", "full_name");
CREATE INDEX IF NOT EXISTS "fantasy_players_sport_team_idx" ON "fantasy_players"("sport", "team");
CREATE INDEX IF NOT EXISTS "fantasy_players_sport_position_idx" ON "fantasy_players"("sport", "position");
CREATE INDEX IF NOT EXISTS "fantasy_players_source_idx" ON "fantasy_players"("source");
CREATE INDEX IF NOT EXISTS "fantasy_players_expires_at_idx" ON "fantasy_players"("expires_at");
