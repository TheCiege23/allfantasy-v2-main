-- League Lab: photo/PDF attachments on ideas, and the staff-only build plan Chimmy writes for each idea.
CREATE TABLE "community_attachments" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "uploaderUserId" TEXT NOT NULL,
    "storageKey" VARCHAR(255) NOT NULL,
    "contentType" VARCHAR(32) NOT NULL,
    "fileName" VARCHAR(160) NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "community_attachments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "community_attachments_postId_createdAt_idx" ON "community_attachments"("postId", "createdAt");
ALTER TABLE "community_attachments" ADD CONSTRAINT "community_attachments_postId_fkey" FOREIGN KEY ("postId") REFERENCES "community_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "community_idea_plans" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "plan" JSONB,
    "model" VARCHAR(64),
    "error" VARCHAR(200),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "generatedAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "community_idea_plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "community_idea_plans_postId_key" ON "community_idea_plans"("postId");
CREATE INDEX "community_idea_plans_status_updatedAt_idx" ON "community_idea_plans"("status", "updatedAt");
ALTER TABLE "community_idea_plans" ADD CONSTRAINT "community_idea_plans_postId_fkey" FOREIGN KEY ("postId") REFERENCES "community_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
