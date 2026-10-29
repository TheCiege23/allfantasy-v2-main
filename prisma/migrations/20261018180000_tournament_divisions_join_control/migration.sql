-- Divisions format: join flow (reveal, preference, FIFO waitlist, invite attribution)
-- and commissioner control (committed seeding and bracket rounds). Additive.

ALTER TABLE "tournament_shell_participants" ADD COLUMN IF NOT EXISTS "revealSeenAt" TIMESTAMP(3);
ALTER TABLE "tournament_shell_participants" ADD COLUMN IF NOT EXISTS "divisionPreference" INTEGER;
ALTER TABLE "tournament_shell_participants" ADD COLUMN IF NOT EXISTS "queuedAt" TIMESTAMP(3);
ALTER TABLE "tournament_shell_participants" ADD COLUMN IF NOT EXISTS "invitedByUserId" TEXT;

ALTER TABLE "tournament_shell_divisions" ADD COLUMN IF NOT EXISTS "seeding" JSONB;
ALTER TABLE "tournament_shell_divisions" ADD COLUMN IF NOT EXISTS "seedingCommittedAt" TIMESTAMP(3);
ALTER TABLE "tournament_shell_divisions" ADD COLUMN IF NOT EXISTS "bracketState" JSONB;
