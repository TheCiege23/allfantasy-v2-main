CREATE TABLE "zombie_role_workflows" (
  "id" VARCHAR(160) NOT NULL,
  "zombieLeagueId" TEXT NOT NULL,
  "kind" VARCHAR(32) NOT NULL,
  "week" INTEGER,
  "actorUserId" TEXT,
  "targetUserId" TEXT,
  "status" VARCHAR(24) NOT NULL DEFAULT 'pending',
  "deadlineAt" TIMESTAMP(3),
  "state" JSONB NOT NULL,
  "decision" VARCHAR(24),
  "decidedByUserId" TEXT,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "zombie_role_workflows_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "zombie_role_workflows_zombieLeagueId_status_idx" ON "zombie_role_workflows"("zombieLeagueId", "status");
CREATE INDEX "zombie_role_workflows_status_deadlineAt_idx" ON "zombie_role_workflows"("status", "deadlineAt");
ALTER TABLE "zombie_role_workflows" ADD CONSTRAINT "zombie_role_workflows_zombieLeagueId_fkey" FOREIGN KEY ("zombieLeagueId") REFERENCES "zombie_leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
