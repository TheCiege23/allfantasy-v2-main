-- Fantasy OS Suite -- Phase OS-A1: League Context Foundation.
-- Apply to a NON-PRODUCTION database only (Neon branch or local dev). Never to production.
-- Provider-agnostic belief about a league's financial context (free/paid/verified-paid, escrow
-- provider, confidence) -- deliberately separate from `league_finance` (AF-native Stripe/PayPal
-- treasury processing). Defaults to UNKNOWN/UNKNOWN/UNKNOWN -- never inferred, never fabricated.

-- CreateEnum
CREATE TYPE "DecisionOsLeagueFinancialStatus" AS ENUM ('UNKNOWN', 'FREE', 'PAID', 'VERIFIED_PAID');

-- CreateEnum
CREATE TYPE "DecisionOsLeagueEscrowProvider" AS ENUM ('LEAGUESAFE', 'FANCRED', 'YAHOO', 'ESPN', 'MANUAL', 'OTHER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DecisionOsLeagueFinancialConfidence" AS ENUM ('UNKNOWN', 'USER_CONFIRMED', 'PROVIDER_CONFIRMED', 'ESCROW_VERIFIED', 'INFERRED');

-- CreateTable
CREATE TABLE "decision_os_league_context" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "financialStatus" "DecisionOsLeagueFinancialStatus" NOT NULL DEFAULT 'UNKNOWN',
    "buyInAmount" DOUBLE PRECISION,
    "buyInCurrency" VARCHAR(8),
    "escrowProvider" "DecisionOsLeagueEscrowProvider" NOT NULL DEFAULT 'UNKNOWN',
    "financialConfidence" "DecisionOsLeagueFinancialConfidence" NOT NULL DEFAULT 'UNKNOWN',
    "financialNotes" VARCHAR(512),
    "isUserConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "decision_os_league_context_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "decision_os_league_context_leagueId_key" ON "decision_os_league_context"("leagueId");
