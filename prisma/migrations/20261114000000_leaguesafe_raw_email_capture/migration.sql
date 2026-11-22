-- Phase 0 capture only. No connection/member/ledger tables or payment parsing.
CREATE TYPE "LeagueSafeEmailProcessingStatus" AS ENUM ('captured', 'parsed', 'unparseable', 'rejected');

CREATE TABLE "LeagueSafeRawEmail" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "rfcMessageId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "rawBody" TEXT NOT NULL,
    "authResults" JSONB NOT NULL,
    "processingStatus" "LeagueSafeEmailProcessingStatus" NOT NULL DEFAULT 'captured',
    "leagueConnectionId" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeagueSafeRawEmail_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LeagueSafeRawEmail_messageId_key" ON "LeagueSafeRawEmail"("messageId");
CREATE INDEX "LeagueSafeRawEmail_createdAt_id_idx" ON "LeagueSafeRawEmail"("createdAt", "id");
CREATE INDEX "LeagueSafeRawEmail_processingStatus_createdAt_id_idx" ON "LeagueSafeRawEmail"("processingStatus", "createdAt", "id");
CREATE INDEX "LeagueSafeRawEmail_leagueConnectionId_idx" ON "LeagueSafeRawEmail"("leagueConnectionId");
