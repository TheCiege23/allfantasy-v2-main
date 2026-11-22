-- CreateEnum
CREATE TYPE "LeagueSafeConnectionStatus" AS ENUM ('pending_invite', 'active', 'stale', 'disconnected');

-- CreateEnum
CREATE TYPE "LeagueSafeMatchMethod" AS ENUM ('exact_email', 'secondary_email', 'name_exact', 'name_fuzzy', 'manual');

-- CreateEnum
CREATE TYPE "DuesLedgerEntryType" AS ENUM ('payment', 'late_fee', 'refund', 'payout', 'adjustment');

-- CreateEnum
CREATE TYPE "DuesLedgerSourceType" AS ENUM ('email', 'screenshot', 'manual');

-- AlterTable
ALTER TABLE "app_users" ADD COLUMN     "leaguesafeEmail" VARCHAR(254);

-- CreateTable
CREATE TABLE "LeagueSafeConnection" (
    "id" TEXT NOT NULL,
    "afLeagueId" TEXT NOT NULL,
    "botAddress" VARCHAR(254) NOT NULL DEFAULT 'allfantasysportsapp@gmail.com',
    "lsLeagueName" VARCHAR(256) NOT NULL,
    "status" "LeagueSafeConnectionStatus" NOT NULL DEFAULT 'pending_invite',
    "lastEmailAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "duesAmountCents" INTEGER NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'usd',
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueSafeConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueSafeMember" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "afLeagueId" TEXT NOT NULL,
    "lsDisplayName" VARCHAR(256) NOT NULL,
    "lsEmail" VARCHAR(254),
    "afTeamId" TEXT,
    "matchMethod" "LeagueSafeMatchMethod",
    "confirmedByCommish" BOOLEAN NOT NULL DEFAULT false,
    "duesAmountCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueSafeMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuesLedgerEntry" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "type" "DuesLedgerEntryType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "sourceRawEmailId" TEXT,
    "sourceType" "DuesLedgerSourceType" NOT NULL,
    "dedupeKey" VARCHAR(256) NOT NULL,
    "createdBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuesLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeagueSafeConnection_afLeagueId_key" ON "LeagueSafeConnection"("afLeagueId");

-- CreateIndex
CREATE INDEX "LeagueSafeConnection_botAddress_idx" ON "LeagueSafeConnection"("botAddress");

-- CreateIndex
CREATE INDEX "LeagueSafeConnection_lsLeagueName_idx" ON "LeagueSafeConnection"("lsLeagueName");

-- CreateIndex
CREATE INDEX "LeagueSafeConnection_status_lastEmailAt_idx" ON "LeagueSafeConnection"("status", "lastEmailAt");

-- CreateIndex
CREATE INDEX "LeagueSafeConnection_createdBy_idx" ON "LeagueSafeConnection"("createdBy");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueSafeConnection_id_afLeagueId_key" ON "LeagueSafeConnection"("id", "afLeagueId");

-- CreateIndex
CREATE INDEX "LeagueSafeMember_connectionId_lsEmail_idx" ON "LeagueSafeMember"("connectionId", "lsEmail");

-- CreateIndex
CREATE INDEX "LeagueSafeMember_afTeamId_afLeagueId_idx" ON "LeagueSafeMember"("afTeamId", "afLeagueId");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueSafeMember_id_connectionId_key" ON "LeagueSafeMember"("id", "connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "DuesLedgerEntry_dedupeKey_key" ON "DuesLedgerEntry"("dedupeKey");

-- CreateIndex
CREATE INDEX "DuesLedgerEntry_connectionId_memberId_occurredAt_id_idx" ON "DuesLedgerEntry"("connectionId", "memberId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "DuesLedgerEntry_sourceRawEmailId_connectionId_idx" ON "DuesLedgerEntry"("sourceRawEmailId", "connectionId");

-- CreateIndex
CREATE INDEX "DuesLedgerEntry_createdBy_idx" ON "DuesLedgerEntry"("createdBy");

-- CreateIndex
CREATE UNIQUE INDEX "league_teams_id_leagueId_key" ON "league_teams"("id", "leagueId");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueSafeRawEmail_id_leagueConnectionId_key" ON "LeagueSafeRawEmail"("id", "leagueConnectionId");

-- AddForeignKey
ALTER TABLE "LeagueSafeRawEmail" ADD CONSTRAINT "LeagueSafeRawEmail_leagueConnectionId_fkey" FOREIGN KEY ("leagueConnectionId") REFERENCES "LeagueSafeConnection"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LeagueSafeConnection" ADD CONSTRAINT "LeagueSafeConnection_afLeagueId_fkey" FOREIGN KEY ("afLeagueId") REFERENCES "leagues"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LeagueSafeConnection" ADD CONSTRAINT "LeagueSafeConnection_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LeagueSafeMember" ADD CONSTRAINT "LeagueSafeMember_connectionId_afLeagueId_fkey" FOREIGN KEY ("connectionId", "afLeagueId") REFERENCES "LeagueSafeConnection"("id", "afLeagueId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LeagueSafeMember" ADD CONSTRAINT "LeagueSafeMember_afTeamId_afLeagueId_fkey" FOREIGN KEY ("afTeamId", "afLeagueId") REFERENCES "league_teams"("id", "leagueId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "DuesLedgerEntry" ADD CONSTRAINT "DuesLedgerEntry_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "LeagueSafeConnection"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "DuesLedgerEntry" ADD CONSTRAINT "DuesLedgerEntry_memberId_connectionId_fkey" FOREIGN KEY ("memberId", "connectionId") REFERENCES "LeagueSafeMember"("id", "connectionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "DuesLedgerEntry" ADD CONSTRAINT "DuesLedgerEntry_sourceRawEmailId_connectionId_fkey" FOREIGN KEY ("sourceRawEmailId", "connectionId") REFERENCES "LeagueSafeRawEmail"("id", "leagueConnectionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "DuesLedgerEntry" ADD CONSTRAINT "DuesLedgerEntry_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Accounting and provenance invariants not expressible in Prisma's schema DSL.
ALTER TABLE "LeagueSafeConnection"
  ADD CONSTRAINT "LeagueSafeConnection_dues_nonnegative" CHECK ("duesAmountCents" >= 0),
  ADD CONSTRAINT "LeagueSafeConnection_name_nonblank" CHECK (btrim("lsLeagueName") <> ''),
  ADD CONSTRAINT "LeagueSafeConnection_currency_format" CHECK ("currency" ~ '^[a-z]{3}$'),
  ADD CONSTRAINT "LeagueSafeConnection_bot_address" CHECK ("botAddress" ~ '^allfantasysportsapp(\+[a-z0-9][a-z0-9-]{0,31})?@gmail\.com$');
ALTER TABLE "LeagueSafeMember"
  ADD CONSTRAINT "LeagueSafeMember_dues_nonnegative" CHECK ("duesAmountCents" IS NULL OR "duesAmountCents" >= 0),
  ADD CONSTRAINT "LeagueSafeMember_name_nonblank" CHECK (btrim("lsDisplayName") <> ''),
  ADD CONSTRAINT "LeagueSafeMember_confirmed_mapping" CHECK (NOT "confirmedByCommish" OR ("afTeamId" IS NOT NULL AND "matchMethod" IS NOT NULL));
ALTER TABLE "DuesLedgerEntry"
  ADD CONSTRAINT "DuesLedgerEntry_amount_sign" CHECK (("type" = 'adjustment' AND "amountCents" <> 0) OR ("type" <> 'adjustment' AND "amountCents" > 0)),
  ADD CONSTRAINT "DuesLedgerEntry_dedupe_nonblank" CHECK (btrim("dedupeKey") <> ''),
  ADD CONSTRAINT "DuesLedgerEntry_email_source" CHECK (("sourceType" = 'email') = ("sourceRawEmailId" IS NOT NULL)),
  ADD CONSTRAINT "DuesLedgerEntry_manual_actor" CHECK ("sourceType" = 'email' OR "createdBy" IS NOT NULL);
