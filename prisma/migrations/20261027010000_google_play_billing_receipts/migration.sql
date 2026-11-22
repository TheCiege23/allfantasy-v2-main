CREATE TABLE "google_play_purchases" (
  "checkoutIntentId" TEXT,
  "tokenHash" VARCHAR(64) NOT NULL,
  "tokenCiphertext" TEXT NOT NULL,
  "ownerId" TEXT,
  "productId" VARCHAR(64) NOT NULL,
  "sku" VARCHAR(64) NOT NULL,
  "purchaseType" VARCHAR(32) NOT NULL,
  "state" VARCHAR(64) NOT NULL,
  "orderId" VARCHAR(256),
  "revokedAt" TIMESTAMP(3),
  "finalizedAt" TIMESTAMP(3),
  "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "google_play_purchases_pkey" PRIMARY KEY ("tokenHash")
);
CREATE INDEX "google_play_purchases_ownerId_idx" ON "google_play_purchases"("ownerId");
CREATE INDEX "google_play_purchases_lastCheckedAt_idx" ON "google_play_purchases"("lastCheckedAt");
CREATE TABLE "google_play_checkout_intents" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sku" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "google_play_checkout_intents_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "google_play_checkout_intents_userId_createdAt_idx" ON "google_play_checkout_intents"("userId", "createdAt");
CREATE INDEX "google_play_checkout_intents_expiresAt_idx" ON "google_play_checkout_intents"("expiresAt");
CREATE UNIQUE INDEX "google_play_purchases_checkoutIntentId_key" ON "google_play_purchases"("checkoutIntentId");
