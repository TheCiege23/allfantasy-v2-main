-- Draft recommendation records (2026-11-14): the forward test for replacement value.
-- A NEW table only — no existing table or column changes. The writer
-- (lib/shared-services/draft/recommendationRecorder.ts) is fire-and-forget and treats a missing
-- table as "not recording yet", so code may ship before this is applied.
-- Reversible: DROP TABLE "draft_recommendation_records";

-- CreateTable
CREATE TABLE "draft_recommendation_records" (
    "id" TEXT NOT NULL,
    "dedupe_key" VARCHAR(191) NOT NULL,
    "surface" VARCHAR(32) NOT NULL,
    "sport" VARCHAR(16) NOT NULL,
    "league_id" TEXT,
    "session_key" VARCHAR(191) NOT NULL,
    "roster_key" VARCHAR(191) NOT NULL,
    "overall_pick" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "served_mode" VARCHAR(16) NOT NULL,
    "observe_name" TEXT,
    "observe_position" VARCHAR(8),
    "active_name" TEXT,
    "active_position" VARCHAR(8),
    "agree" BOOLEAN NOT NULL,
    "projection_count" INTEGER NOT NULL,
    "pool_size" INTEGER NOT NULL,
    "detail" JSONB NOT NULL,
    "engine_version" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draft_recommendation_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "draft_recommendation_records_dedupe_key_key" ON "draft_recommendation_records"("dedupe_key");

-- CreateIndex
CREATE INDEX "draft_recommendation_records_created_at_idx" ON "draft_recommendation_records"("created_at");

-- CreateIndex
CREATE INDEX "draft_recommendation_records_league_id_idx" ON "draft_recommendation_records"("league_id");

-- CreateIndex
CREATE INDEX "draft_recommendation_records_sport_agree_idx" ON "draft_recommendation_records"("sport", "agree");

