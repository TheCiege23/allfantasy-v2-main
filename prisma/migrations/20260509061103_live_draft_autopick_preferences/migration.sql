-- Commit 5: canonical per-user, per-DraftSession auto-pick preference.
-- Replaces (going forward) the legacy `draft_autopick_settings` table which is keyed by sessionKey.
-- Legacy table is left intact for the mock-draft toggle route; cleanup is a separate commit.

-- CreateTable
CREATE TABLE "live_draft_autopick_preferences" (
    "id" TEXT NOT NULL,
    "draft_session_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" VARCHAR(32) NOT NULL DEFAULT 'standard',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_draft_autopick_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "live_draft_autopick_preferences_draft_session_id_user_id_key" ON "live_draft_autopick_preferences"("draft_session_id", "user_id");

-- CreateIndex
CREATE INDEX "live_draft_autopick_preferences_draft_session_id_idx" ON "live_draft_autopick_preferences"("draft_session_id");

-- CreateIndex
CREATE INDEX "live_draft_autopick_preferences_user_id_idx" ON "live_draft_autopick_preferences"("user_id");

-- AddForeignKey
ALTER TABLE "live_draft_autopick_preferences" ADD CONSTRAINT "live_draft_autopick_preferences_draft_session_id_fkey" FOREIGN KEY ("draft_session_id") REFERENCES "draft_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_draft_autopick_preferences" ADD CONSTRAINT "live_draft_autopick_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
