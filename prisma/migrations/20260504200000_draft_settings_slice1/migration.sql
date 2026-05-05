-- Slice 1 — typed draft settings columns on DraftSession.
-- Reuses existing thirdRoundReversal column and existing draftUISettings.timerMode for soft timer.
-- Adds 3 genuinely new typed flags.

ALTER TABLE "draft_sessions"
  ADD COLUMN IF NOT EXISTS "onClockTradeTimerBehavior" VARCHAR(32) NOT NULL DEFAULT 'inherit_remaining',
  ADD COLUMN IF NOT EXISTS "inDraftPlayerTradesEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "customRankingsEnabled" BOOLEAN NOT NULL DEFAULT true;

-- Defensive value clamp: anything not in the allowed set falls back to default.
UPDATE "draft_sessions"
SET "onClockTradeTimerBehavior" = 'inherit_remaining'
WHERE "onClockTradeTimerBehavior" NOT IN ('inherit_remaining', 'reset_timer');
