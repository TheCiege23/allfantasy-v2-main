-- AlterTable
ALTER TABLE "community_posts" ADD COLUMN     "systemKey" VARCHAR(64);

-- CreateIndex
CREATE UNIQUE INDEX "community_posts_systemKey_key" ON "community_posts"("systemKey");

