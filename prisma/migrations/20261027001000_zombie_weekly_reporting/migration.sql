ALTER TABLE "zombie_team_items" ADD COLUMN "acquiredAtWeek" INTEGER;
ALTER TABLE "zombie_announcements" ADD COLUMN "idempotencyKey" VARCHAR(128);
CREATE UNIQUE INDEX "zombie_announcements_idempotencyKey_key" ON "zombie_announcements"("idempotencyKey");
ALTER TABLE "league_chat_messages" ADD COLUMN "zombieWeeklyAnnouncementId" VARCHAR(64);
CREATE UNIQUE INDEX "league_chat_messages_zombieWeeklyAnnouncementId_key" ON "league_chat_messages"("zombieWeeklyAnnouncementId");
CREATE TABLE "zombie_external_weekly_payouts" (
  "id" TEXT NOT NULL,
  "zombieLeagueId" TEXT NOT NULL,
  "week" INTEGER NOT NULL,
  "winnerRosterId" VARCHAR(64) NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "providerName" VARCHAR(80) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'recorded',
  "reference" VARCHAR(160),
  "recordedById" VARCHAR(64) NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3),
  CONSTRAINT "zombie_external_weekly_payouts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "zombie_external_weekly_payouts_zombieLeagueId_week_key" ON "zombie_external_weekly_payouts"("zombieLeagueId", "week");
CREATE INDEX "zombie_external_weekly_payouts_winnerRosterId_idx" ON "zombie_external_weekly_payouts"("winnerRosterId");
ALTER TABLE "zombie_external_weekly_payouts" ADD CONSTRAINT "zombie_external_weekly_payouts_zombieLeagueId_fkey" FOREIGN KEY ("zombieLeagueId") REFERENCES "zombie_leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
