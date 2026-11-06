-- Auction bid history: one row per ACCEPTED bid in an AllFantasy-run auction draft room.
-- Written best-effort by lib/live-draft-engine/auction/auctionBidLog.ts; the room reads it for
-- the bid ladder. Code ships ahead of this migration and skips the write/read while the table is
-- absent, so applying it only turns history on. Generated with `prisma migrate diff` from the
-- schema before and after the AuctionBid model.

-- CreateTable
CREATE TABLE "auction_bids" (
    "id" TEXT NOT NULL,
    "draft_session_id" TEXT NOT NULL,
    "league_id" TEXT NOT NULL,
    "player_key" VARCHAR(191) NOT NULL,
    "player_id" TEXT,
    "player_name" TEXT NOT NULL,
    "roster_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auction_bids_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auction_bids_draft_session_id_player_key_created_at_idx" ON "auction_bids"("draft_session_id", "player_key", "created_at");

-- CreateIndex
CREATE INDEX "auction_bids_draft_session_id_created_at_idx" ON "auction_bids"("draft_session_id", "created_at");

-- AddForeignKey
ALTER TABLE "auction_bids" ADD CONSTRAINT "auction_bids_draft_session_id_fkey" FOREIGN KEY ("draft_session_id") REFERENCES "draft_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

