-- Decision OS Phase 3A — canonical decision record + immutable revision history (shadow-only persistence sink).
-- Purely ADDITIVE: creates TWO new tables (current-state `canonical_decisions` + append-only
-- `canonical_decision_revisions`) with their indexes + one FK BETWEEN the two new tables. No ALTER/DROP on any
-- pre-existing table. The revision table's OCCURRENCE IDENTITY is UNIQUE(decision_id, run_id) — at most one
-- immutable revision per run; `content_hash` is a non-identity integrity field. Generated offline via
-- 'prisma migrate diff' (datamodel-to-datamodel, no DB connection). NOT applied to production by any build/deploy
-- step; apply via the documented repo convention (direct SQL + 'migrate resolve --applied') to an isolated/dev DB
-- only. See docs/decision-os/PHASE2_MIGRATION_RUNBOOK.md.

-- CreateTable
CREATE TABLE "canonical_decisions" (
    "id" TEXT NOT NULL,
    "contract_version" VARCHAR(16) NOT NULL,
    "decision_id" VARCHAR(191) NOT NULL,
    "fingerprint" VARCHAR(191) NOT NULL,
    "user_id" TEXT,
    "league_id" TEXT,
    "connected_franchise_id" TEXT,
    "source_platform" VARCHAR(24),
    "sport" VARCHAR(16) NOT NULL,
    "season" INTEGER,
    "period" VARCHAR(32),
    "category" VARCHAR(48) NOT NULL,
    "subtype" VARCHAR(48),
    "subject_key" VARCHAR(191),
    "scope" VARCHAR(16) NOT NULL,
    "audience" VARCHAR(16) NOT NULL,
    "headline" VARCHAR(300) NOT NULL,
    "explanation" TEXT NOT NULL,
    "recommended_action" TEXT,
    "evidence" JSONB,
    "confidence_pct" INTEGER,
    "severity" VARCHAR(16) NOT NULL,
    "urgency" VARCHAR(16) NOT NULL,
    "priority_score" INTEGER,
    "expected_impact" TEXT,
    "players" JSONB,
    "team_ref" TEXT,
    "source" JSONB,
    "source_execution_policy" VARCHAR(32) NOT NULL DEFAULT 'external_read_only',
    "source_read_only" BOOLEAN NOT NULL DEFAULT true,
    "data_as_of" TIMESTAMP(3),
    "generated_at" TIMESTAMP(3) NOT NULL,
    "stale_at" TIMESTAMP(3),
    "freshness" VARCHAR(16) NOT NULL,
    "entitlement_tier" VARCHAR(24) NOT NULL,
    "token_cost_class" VARCHAR(24) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "suppression_reason" VARCHAR(128),
    "conflict_group_key" VARCHAR(191),
    "supersedes_decision_id" VARCHAR(191),
    "producer" VARCHAR(64) NOT NULL,
    "producer_version" VARCHAR(32) NOT NULL,
    "run_id" TEXT,
    "extensions" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canonical_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canonical_decision_revisions" (
    "id" TEXT NOT NULL,
    "decision_id" VARCHAR(191) NOT NULL,
    "run_id" VARCHAR(191) NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "producer" VARCHAR(64) NOT NULL,
    "producer_version" VARCHAR(32) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "supersedes_decision_id" VARCHAR(191),
    "headline" VARCHAR(300) NOT NULL,
    "explanation" TEXT NOT NULL,
    "recommended_action" TEXT,
    "evidence" JSONB,
    "confidence_pct" INTEGER,
    "priority_score" INTEGER,
    "severity" VARCHAR(16) NOT NULL,
    "urgency" VARCHAR(16) NOT NULL,
    "source" JSONB,
    "data_as_of" TIMESTAMP(3),
    "generated_at" TIMESTAMP(3) NOT NULL,
    "stale_at" TIMESTAMP(3),
    "freshness" VARCHAR(16) NOT NULL,
    "extensions" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canonical_decision_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "canonical_decisions_decision_id_key" ON "canonical_decisions"("decision_id");

-- CreateIndex
CREATE INDEX "canonical_decisions_user_id_category_idx" ON "canonical_decisions"("user_id", "category");

-- CreateIndex
CREATE INDEX "canonical_decisions_league_id_category_idx" ON "canonical_decisions"("league_id", "category");

-- CreateIndex
CREATE INDEX "canonical_decisions_sport_season_idx" ON "canonical_decisions"("sport", "season");

-- CreateIndex
CREATE INDEX "canonical_decisions_status_severity_idx" ON "canonical_decisions"("status", "severity");

-- CreateIndex
CREATE INDEX "canonical_decisions_connected_franchise_id_idx" ON "canonical_decisions"("connected_franchise_id");

-- CreateIndex
CREATE INDEX "canonical_decisions_run_id_idx" ON "canonical_decisions"("run_id");

-- CreateIndex
CREATE INDEX "canonical_decisions_conflict_group_key_idx" ON "canonical_decisions"("conflict_group_key");

-- CreateIndex
CREATE INDEX "canonical_decisions_source_platform_idx" ON "canonical_decisions"("source_platform");

-- CreateIndex
CREATE INDEX "canonical_decisions_generated_at_idx" ON "canonical_decisions"("generated_at");

-- CreateIndex
CREATE INDEX "canonical_decisions_stale_at_idx" ON "canonical_decisions"("stale_at");

-- CreateIndex
CREATE INDEX "canonical_decision_revisions_decision_id_created_at_idx" ON "canonical_decision_revisions"("decision_id", "created_at");

-- CreateIndex
CREATE INDEX "canonical_decision_revisions_run_id_idx" ON "canonical_decision_revisions"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "canonical_decision_revisions_decision_id_run_id_key" ON "canonical_decision_revisions"("decision_id", "run_id");

-- AddForeignKey
ALTER TABLE "canonical_decision_revisions" ADD CONSTRAINT "canonical_decision_revisions_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "canonical_decisions"("decision_id") ON DELETE CASCADE ON UPDATE CASCADE;
