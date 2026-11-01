-- Clubhouse: the public community board (lib/community/). Four new tables, nothing altered.
-- Additive only, so code that does not read these tables is unaffected whether or not this
-- has been applied.

CREATE TABLE "community_posts" (
    "id" TEXT NOT NULL,
    "channel" VARCHAR(32) NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "removedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_posts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "community_replies" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "removedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_replies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "community_reactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetType" VARCHAR(8) NOT NULL,
    "targetId" TEXT NOT NULL,
    "emoji" VARCHAR(16) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_reactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "community_reports" (
    "id" TEXT NOT NULL,
    "reporterUserId" TEXT NOT NULL,
    "targetType" VARCHAR(8) NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" VARCHAR(32) NOT NULL,
    "details" VARCHAR(500),
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "community_posts_channel_isPinned_lastActivityAt_idx" ON "community_posts"("channel", "isPinned", "lastActivityAt");
CREATE INDEX "community_posts_lastActivityAt_idx" ON "community_posts"("lastActivityAt");
CREATE INDEX "community_posts_authorUserId_createdAt_idx" ON "community_posts"("authorUserId", "createdAt");
CREATE INDEX "community_replies_postId_createdAt_idx" ON "community_replies"("postId", "createdAt");
CREATE INDEX "community_replies_authorUserId_createdAt_idx" ON "community_replies"("authorUserId", "createdAt");
CREATE UNIQUE INDEX "community_reactions_userId_targetType_targetId_emoji_key" ON "community_reactions"("userId", "targetType", "targetId", "emoji");
CREATE INDEX "community_reactions_targetType_targetId_idx" ON "community_reactions"("targetType", "targetId");
CREATE UNIQUE INDEX "community_reports_reporterUserId_targetType_targetId_key" ON "community_reports"("reporterUserId", "targetType", "targetId");
CREATE INDEX "community_reports_status_createdAt_idx" ON "community_reports"("status", "createdAt");
CREATE INDEX "community_reports_targetType_targetId_idx" ON "community_reports"("targetType", "targetId");

ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_replies" ADD CONSTRAINT "community_replies_postId_fkey" FOREIGN KEY ("postId") REFERENCES "community_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_replies" ADD CONSTRAINT "community_replies_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_reactions" ADD CONSTRAINT "community_reactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
