-- Decision OS three-brain (Phase 2 hardening) — TRUE token reservation lifecycle.
-- Purely ADDITIVE: one new column (default 0) + one new table + indexes + one FK. No DROP/data change.
-- Generated offline via `prisma migrate diff` (no database connection). Apply to an isolated/dev DB only.

-- AlterTable
ALTER TABLE "user_token_balances" ADD COLUMN "reserved_balance" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "token_reservations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_token_balance_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'reserved',
    "spend_rule_code" VARCHAR(64),
    "source_type" VARCHAR(64),
    "source_id" VARCHAR(255),
    "idempotency_key" VARCHAR(255) NOT NULL,
    "intelligence_run_id" TEXT,
    "finalized_ledger_id" TEXT,
    "reason" VARCHAR(128),
    "reserved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalized_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "token_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "token_reservations_idempotency_key_key" ON "token_reservations"("idempotency_key");

-- CreateIndex
CREATE INDEX "token_reservations_user_id_status_idx" ON "token_reservations"("user_id", "status");

-- CreateIndex
CREATE INDEX "token_reservations_status_expires_at_idx" ON "token_reservations"("status", "expires_at");

-- CreateIndex
CREATE INDEX "token_reservations_intelligence_run_id_idx" ON "token_reservations"("intelligence_run_id");

-- AddForeignKey
ALTER TABLE "token_reservations" ADD CONSTRAINT "token_reservations_user_token_balance_id_fkey" FOREIGN KEY ("user_token_balance_id") REFERENCES "user_token_balances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
