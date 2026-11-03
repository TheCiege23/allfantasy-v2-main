CREATE TABLE "zombie_operations_records" (
  "id" VARCHAR(180) NOT NULL,
  "scope" VARCHAR(100) NOT NULL,
  "season" INTEGER NOT NULL,
  "kind" VARCHAR(32) NOT NULL,
  "payload" JSONB NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "zombie_operations_records_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "zombie_operations_records_scope_season_kind_idx" ON "zombie_operations_records"("scope", "season", "kind");
