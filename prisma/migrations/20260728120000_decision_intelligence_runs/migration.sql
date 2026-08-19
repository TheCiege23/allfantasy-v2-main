-- Decision OS three-brain (Phase 2) — durable managed-intelligence run + result cache.
-- Purely ADDITIVE: creates one new table + its indexes. No ALTER/DROP on any existing table.
-- Generated offline via `prisma migrate diff` (no database connection). NOT applied to production.
-- Apply to an isolated/dev database only (repo convention applies migration SQL directly).

-- CreateTable
CREATE TABLE "decision_intelligence_runs" (
    "id" TEXT NOT NULL,
    "result_key" VARCHAR(255) NOT NULL,
    "input_hash" VARCHAR(128) NOT NULL,
    "tool" VARCHAR(64) NOT NULL,
    "decision_type" VARCHAR(64) NOT NULL,
    "user_id" TEXT NOT NULL,
    "league_id" TEXT,
    "connected_group_id" TEXT,
    "sport" VARCHAR(16),
    "platform" VARCHAR(24),
    "entitlement_mode" VARCHAR(24),
    "status" VARCHAR(24) NOT NULL DEFAULT 'pending',
    "version_tag" VARCHAR(64) NOT NULL,
    "agreement_state" VARCHAR(32),
    "claude_state" VARCHAR(32),
    "provider_participation" JSONB,
    "result_json" JSONB,
    "request_snapshot" JSONB,
    "failure_category" VARCHAR(48),
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "owner_token" VARCHAR(80),
    "lease_expires_at" TIMESTAMP(3),
    "token_ledger_id" TEXT,
    "token_reservation_key" VARCHAR(255),
    "correlation_id" VARCHAR(64),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "last_accessed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "decision_intelligence_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "decision_intelligence_runs_result_key_key" ON "decision_intelligence_runs"("result_key");

-- CreateIndex
CREATE INDEX "decision_intelligence_runs_user_id_tool_idx" ON "decision_intelligence_runs"("user_id", "tool");

-- CreateIndex
CREATE INDEX "decision_intelligence_runs_league_id_idx" ON "decision_intelligence_runs"("league_id");

-- CreateIndex
CREATE INDEX "decision_intelligence_runs_status_lease_expires_at_idx" ON "decision_intelligence_runs"("status", "lease_expires_at");

-- CreateIndex
CREATE INDEX "decision_intelligence_runs_input_hash_idx" ON "decision_intelligence_runs"("input_hash");

-- CreateIndex
CREATE INDEX "decision_intelligence_runs_expires_at_idx" ON "decision_intelligence_runs"("expires_at");
