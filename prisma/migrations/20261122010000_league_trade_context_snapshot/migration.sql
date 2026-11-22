-- The situation around a trade when the live sync first saw it (lib/trade-market/tradeContextSnapshot.ts).
-- Nullable, no default: adding it rewrites no rows and takes no lasting lock.
ALTER TABLE "LeagueTrade" ADD COLUMN "contextSnapshot" JSONB;
