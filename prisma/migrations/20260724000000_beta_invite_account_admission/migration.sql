-- P0-1 BETA-GATE: closed-beta account admission.
-- Additive only: a single new table, no ALTER to any existing table, no foreign keys.
-- Rollback = DROP TABLE "beta_invites"; reopening signup does NOT require this rollback
-- (flip INVITE_ONLY off instead). NOT applied to production by this change — it goes
-- through the separate migration gate.

-- CreateTable
CREATE TABLE "beta_invites" (
    "id" TEXT NOT NULL,
    "tokenDigest" TEXT NOT NULL,
    "invitedEmail" TEXT NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "createdByAdmin" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "redeemedAt" TIMESTAMP(3),
    "redeemedByUserId" TEXT,

    CONSTRAINT "beta_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "beta_invites_tokenDigest_key" ON "beta_invites"("tokenDigest");

-- CreateIndex
CREATE INDEX "beta_invites_invitedEmail_idx" ON "beta_invites"("invitedEmail");

-- CreateIndex
CREATE INDEX "beta_invites_status_idx" ON "beta_invites"("status");

-- CreateIndex
CREATE INDEX "beta_invites_redeemedByUserId_idx" ON "beta_invites"("redeemedByUserId");
