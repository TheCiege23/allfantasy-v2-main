-- Decision OS three-brain (Phase 2 hardening) — hard-crash UNKNOWN-outcome marker.
-- Purely ADDITIVE: one new nullable column on an existing Phase 2 table. No DROP/ALTER-of-type/data change.
-- Generated offline (no database connection). Apply to an isolated/dev DB only (repo convention applies migration SQL directly).

-- AlterTable
ALTER TABLE "decision_intelligence_runs" ADD COLUMN "provider_exec_started_at" TIMESTAMP(3);
