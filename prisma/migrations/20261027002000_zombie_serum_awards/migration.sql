ALTER TABLE "zombie_team_items" ADD COLUMN "awardKey" VARCHAR(160);
CREATE UNIQUE INDEX "zombie_team_items_awardKey_key" ON "zombie_team_items"("awardKey");
