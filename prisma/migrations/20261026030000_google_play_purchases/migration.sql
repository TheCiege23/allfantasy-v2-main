-- Google Play Billing: one row per verified Play purchase token. A new table
-- only; user_subscriptions is untouched, so applying this late cannot break
-- existing subscription reads.
CREATE TABLE "google_play_purchases" (
    "id" TEXT NOT NULL,
    "purchaseTokenHash" VARCHAR(64) NOT NULL,
    "purchaseToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" VARCHAR(64) NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "userSubscriptionId" TEXT,
    "latestOrderId" VARCHAR(128),
    "state" VARCHAR(64),
    "testPurchase" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_play_purchases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "google_play_purchases_purchaseTokenHash_key" ON "google_play_purchases"("purchaseTokenHash");
CREATE INDEX "google_play_purchases_userId_idx" ON "google_play_purchases"("userId");
CREATE INDEX "google_play_purchases_userSubscriptionId_idx" ON "google_play_purchases"("userSubscriptionId");
