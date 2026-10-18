-- Shared Tribal Council reveal cursor: reveal_next advances this instead of deleting
-- steps from revealSequence, so Replay keeps working and clients are gated by step.
ALTER TABLE "survivor_tribal_councils" ADD COLUMN IF NOT EXISTS "revealStep" INTEGER NOT NULL DEFAULT 0;
