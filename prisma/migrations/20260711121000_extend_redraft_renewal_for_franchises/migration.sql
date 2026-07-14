-- Stage 2: additive franchise-aware renewal persistence.
ALTER TYPE "league_renewal_status" ADD VALUE 'confirming';
ALTER TYPE "league_renewal_status" ADD VALUE 'ready';
ALTER TYPE "league_renewal_status" ADD VALUE 'archived';
ALTER TYPE "league_renewal_status" ADD VALUE 'cancelled';
ALTER TYPE "league_renewal_slot_status" ADD VALUE 'vacant';
ALTER TYPE "league_renewal_slot_status" ADD VALUE 'replacement_invited';
ALTER TYPE "league_renewal_slot_status" ADD VALUE 'replacement_accepted';
ALTER TYPE "league_renewal_slot_status" ADD VALUE 'commissioner_confirmed';
ALTER TYPE "league_renewal_slot_status" ADD VALUE 'removed';

ALTER TABLE "league_renewals"
  ADD COLUMN "priorSeasonId" TEXT,
  ADD COLUMN "nextSeasonId" TEXT,
  ADD COLUMN "deadlineAt" TIMESTAMP(3),
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "createdByUserId" VARCHAR(64),
  ADD COLUMN "majorChangeApprovalPolicy" VARCHAR(32),
  ADD COLUMN "settingsProposalVersionId" TEXT,
  ADD COLUMN "scoringProposalVersionId" TEXT;

ALTER TABLE "league_renewal_slots"
  ADD COLUMN "franchiseId" VARCHAR(64),
  ADD COLUMN "priorManagerId" VARCHAR(64),
  ADD COLUMN "candidateManagerId" VARCHAR(64),
  ADD COLUMN "confirmedManagerId" VARCHAR(64),
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "confirmedByUserId" VARCHAR(64),
  ADD COLUMN "replacementInvitationId" TEXT,
  ADD COLUMN "decisionAt" TIMESTAMP(3),
  ADD COLUMN "removedFromNextSeason" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "league_renewals_nextSeasonId_key" ON "league_renewals"("nextSeasonId");
CREATE INDEX "league_renewals_priorSeasonId_idx" ON "league_renewals"("priorSeasonId");
CREATE UNIQUE INDEX "league_renewal_slots_renewalId_franchiseId_key" ON "league_renewal_slots"("renewalId", "franchiseId");
CREATE UNIQUE INDEX "redraft_seasons_leagueId_season_key" ON "redraft_seasons"("leagueId", "season");

-- Backfill only an exact one-user-to-one-franchise match within the renewal league.
WITH candidates AS (
  SELECT s."id" AS "slotId", MIN(t."id") AS "franchiseId", COUNT(*) AS matches
  FROM "league_renewal_slots" s
  JOIN "league_teams" t ON t."leagueId" = s."leagueId"
   AND (t."platformUserId" = s."userId" OR t."claimedByUserId" = s."userId")
  GROUP BY s."id"
), unique_candidates AS (
  SELECT "slotId", "franchiseId" FROM candidates WHERE matches = 1
)
UPDATE "league_renewal_slots" s
SET "franchiseId" = c."franchiseId",
    "priorManagerId" = s."userId",
    "candidateManagerId" = CASE WHEN s."status" = 'confirmed' THEN s."userId" ELSE NULL END,
    "decisionAt" = s."respondedAt"
FROM unique_candidates c
WHERE s."id" = c."slotId" AND s."franchiseId" IS NULL;
