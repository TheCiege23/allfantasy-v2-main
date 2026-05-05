-- Player identity mismatch audit for draft enrichment (AI/admin review). Safe logging only.

CREATE TABLE IF NOT EXISTS "player_identity_mismatch_logs" (
    "id" TEXT NOT NULL,
    "league_id" TEXT,
    "sport" VARCHAR(16) NOT NULL,
    "pool_player_id" VARCHAR(128),
    "pool_external_id" VARCHAR(128),
    "sports_player_record_id" VARCHAR(128),
    "player_name" VARCHAR(256),
    "position" VARCHAR(64),
    "team" VARCHAR(64),
    "attempted_match_type" VARCHAR(32),
    "confidence" DECIMAL(5,4),
    "reason" VARCHAR(64) NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_identity_mismatch_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "player_identity_mismatch_logs_sport_created_at_idx" ON "player_identity_mismatch_logs"("sport", "created_at");
CREATE INDEX IF NOT EXISTS "player_identity_mismatch_logs_league_id_idx" ON "player_identity_mismatch_logs"("league_id");
