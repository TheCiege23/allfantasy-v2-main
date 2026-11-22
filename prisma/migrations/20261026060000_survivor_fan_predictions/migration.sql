-- CreateTable
CREATE TABLE "survivor_fan_predictions" (
    "id" TEXT NOT NULL,
    "leagueId" VARCHAR(64) NOT NULL,
    "councilId" VARCHAR(64) NOT NULL,
    "week" INTEGER NOT NULL,
    "fanUserId" VARCHAR(64) NOT NULL,
    "pickedUserId" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "survivor_fan_predictions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "survivor_fan_predictions_leagueId_fanUserId_idx" ON "survivor_fan_predictions"("leagueId", "fanUserId");

-- CreateIndex
CREATE UNIQUE INDEX "survivor_fan_predictions_councilId_fanUserId_key" ON "survivor_fan_predictions"("councilId", "fanUserId");

