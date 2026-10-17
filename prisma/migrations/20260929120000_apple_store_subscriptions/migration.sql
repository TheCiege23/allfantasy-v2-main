ALTER TABLE "user_subscriptions"
  ADD COLUMN "appleOriginalTransactionId" VARCHAR(128),
  ADD COLUMN "appleLatestTransactionId" VARCHAR(128);

CREATE UNIQUE INDEX "user_subscriptions_appleOriginalTransactionId_key"
  ON "user_subscriptions"("appleOriginalTransactionId");
