-- The commissioner's "inactive manager" flag, recorded so it can be graded (lib/commissioner-hub/inactiveFlagLedger.ts).
-- One row per stretch a NATIVE league's manager was shown as inactive, keyed by the last action they were idle
-- from; graded two weeks later as came_back / stayed_away.
-- Additive: one new table. Nothing reads or writes it until the code that does is deployed, and that code
-- treats a missing table as "nothing recorded", so this can be applied before or after it.

-- CreateTable
CREATE TABLE "commissioner_inactive_flags" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "rosterId" TEXT NOT NULL,
    "lastActionAt" TIMESTAMPTZ(6) NOT NULL,
    "flaggedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" VARCHAR(16),
    "gradedAt" TIMESTAMPTZ(6),

    CONSTRAINT "commissioner_inactive_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "commissioner_inactive_flags_leagueId_rosterId_lastActionAt_key" ON "commissioner_inactive_flags"("leagueId", "rosterId", "lastActionAt");

-- CreateIndex
CREATE INDEX "commissioner_inactive_flags_outcome_flaggedAt_idx" ON "commissioner_inactive_flags"("outcome", "flaggedAt");
