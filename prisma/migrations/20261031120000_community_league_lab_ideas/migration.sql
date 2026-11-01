-- AlterTable
ALTER TABLE "community_posts" ADD COLUMN     "ideaDetails" JSONB,
ADD COLUMN     "ideaStatus" VARCHAR(16),
ADD COLUMN     "ideaStatusAt" TIMESTAMP(3),
ADD COLUMN     "kind" VARCHAR(16) NOT NULL DEFAULT 'post',
ADD COLUMN     "upvoteCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "community_idea_votes" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_idea_votes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "community_idea_votes_userId_idx" ON "community_idea_votes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "community_idea_votes_postId_userId_key" ON "community_idea_votes"("postId", "userId");

-- CreateIndex
CREATE INDEX "community_posts_kind_upvoteCount_idx" ON "community_posts"("kind", "upvoteCount");

-- AddForeignKey
ALTER TABLE "community_idea_votes" ADD CONSTRAINT "community_idea_votes_postId_fkey" FOREIGN KEY ("postId") REFERENCES "community_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_idea_votes" ADD CONSTRAINT "community_idea_votes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

