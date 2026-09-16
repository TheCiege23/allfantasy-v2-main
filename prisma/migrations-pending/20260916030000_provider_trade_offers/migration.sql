-- Provider-side trade offers: the unsettled half of the trade ledger.
--
-- 🛑 PARKED. This lives in prisma/migrations-pending/ because applying it has NOT been authorised.
-- Move it to prisma/migrations/ only as part of an authorised apply — `prisma migrate deploy` reads
-- the DIRECTORY, not git, so anything sitting in the real directory is applied by whoever next runs
-- it, for whatever reason they were running it. See that directory's README.
--
-- ── WHAT IT ADDS, AND WHAT IT DELIBERATELY DOES NOT TOUCH ──────────────────────────────────────
--
-- Two new tables. NOTHING is altered or dropped: `dw_transaction_facts` is not modified, and no
-- existing row, column, index or constraint anywhere is affected. Purely additive.
--
-- The reason it is additive is the whole design decision. `dw_transaction_facts` is a SETTLED-EVENTS
-- fact table, and ten readers depend on that meaning without filtering by `type` — they count rows
-- and mean "things that happened":
--
--   lib/data-warehouse/LeagueHistoryAggregator.ts      raw count({ leagueId })
--   lib/data-warehouse/WarehouseQueryService.ts        getTransactionVolumeByLeague
--   lib/data-warehouse/AnalyticsQueryLayer.ts          count AND findLatestCreatedAt (recency)
--   app/api/league/wrapped/route.ts                    user-facing season recap, grouped by type
--   lib/strategy-meta-engine/MetaAnalysisService.ts    market-wide volume, every league
--   lib/core-app/decisionReceipts.ts                   _max(weekOrPeriod) — the SYNC WATERMARK
--
-- Adding pending/rejected/expired rows to that table would inflate all of them silently, and the
-- watermark one is not even a count: a pending week-14 offer would advance "how far this league has
-- synced" past what actually settled. Keeping the unsettled half in its own table makes those ten
-- readers correct BY CONSTRUCTION rather than by an audit that must not miss one.
--
-- ⚠ `provider_trade_offers.last_seen_at` HAS NO DEFAULT AND NO `@updatedAt`, ON PURPOSE. It is the
-- evidence for calling an offer `vanished`, so it must mean "when we last SAW this in the feed",
-- not "when we last wrote this row". A default would let a write that never read the feed advance
-- it, which is exactly the false-evidence this column exists to avoid.
--
-- ⚠ THE DDL BELOW IS PRISMA'S OWN OUTPUT, PASTED VERBATIM, AND IT REPLACED A HAND-WRITTEN VERSION.
--
-- 🛑 HAND-WRITING IT WAS A REAL BUG AND IT WAS SILENT. Checked before applying, by generating the
-- canonical DDL offline (`migrate diff --from-empty --to-schema-datamodel`, no database involved)
-- and diffing. SEVEN index names disagreed and TWO column defaults were invented:
--
--   mine                                                Prisma's
--   uniq_provider_trade_offer                           provider_trade_offers_provider_leagueId_providerTradeId_key
--   provider_trade_offers_league_status_idx             provider_trade_offers_leagueId_status_idx
--   provider_trade_offers_league_status_last_seen_idx   provider_trade_offers_leagueId_status_lastSeenAt_idx
--   provider_trade_offers_league_season_week_idx        provider_trade_offers_leagueId_season_weekOrPeriod_idx
--   provider_trade_offer_assets_offer_idx               provider_trade_offer_assets_offerId_idx
--   provider_trade_offer_assets_player_idx              provider_trade_offer_assets_playerId_idx
--   provider_trade_offer_assets_offer_type_idx          provider_trade_offer_assets_offerId_assetType_idx
--   rosterIds ... DEFAULT ARRAY[]::TEXT[]               (no default — the schema declares none)
--
-- Every one of those would have applied cleanly and then drifted FOREVER: the tables would be
-- functionally correct, nothing would fail, and `migrate diff` would want to rename seven indexes
-- and drop two defaults on every run from then on. A migration that works is not the same as a
-- migration that agrees with the schema it came from.
--
-- ⚠ `@@unique(..., name:)` IS THE TRAP THAT PRODUCED THE UNIQUE-INDEX HALF. In Prisma, `name:`
-- names the CLIENT accessor (which the writer uses, correctly, as `uniq_provider_trade_offer`);
-- `map:` is what names the database object. Reading `name:` as the constraint name is how the SQL
-- and the schema came to disagree while both looked right.
--
-- So: generate this, never type it. The comments above are ours; every statement below is Prisma's.

CREATE TABLE "provider_trade_offers" (
    "id" TEXT NOT NULL,
    "leagueId" VARCHAR(64) NOT NULL,
    "provider" VARCHAR(16) NOT NULL,
    "providerTradeId" VARCHAR(128) NOT NULL,
    "sport" VARCHAR(12) NOT NULL,
    "season" INTEGER,
    "weekOrPeriod" INTEGER,
    "status" VARCHAR(16) NOT NULL,
    "providerStatus" VARCHAR(32),
    "proposedByRosterId" VARCHAR(64),
    "rosterIds" TEXT[],
    "consentedRosterIds" TEXT[],
    "proposedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB,

    CONSTRAINT "provider_trade_offers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provider_trade_offer_assets" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "assetType" VARCHAR(16) NOT NULL,
    "playerId" VARCHAR(64),
    "pickSeason" INTEGER,
    "pickRound" INTEGER,
    "pickOriginalRosterId" VARCHAR(64),
    "faabAmount" INTEGER,
    "fromRosterId" VARCHAR(64),
    "toRosterId" VARCHAR(64),
    "metadata" JSONB,

    CONSTRAINT "provider_trade_offer_assets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "provider_trade_offers_leagueId_status_idx" ON "provider_trade_offers"("leagueId", "status");
CREATE INDEX "provider_trade_offers_leagueId_status_lastSeenAt_idx" ON "provider_trade_offers"("leagueId", "status", "lastSeenAt");
CREATE INDEX "provider_trade_offers_leagueId_season_weekOrPeriod_idx" ON "provider_trade_offers"("leagueId", "season", "weekOrPeriod");
CREATE UNIQUE INDEX "provider_trade_offers_provider_leagueId_providerTradeId_key" ON "provider_trade_offers"("provider", "leagueId", "providerTradeId");
CREATE INDEX "provider_trade_offer_assets_offerId_idx" ON "provider_trade_offer_assets"("offerId");
CREATE INDEX "provider_trade_offer_assets_playerId_idx" ON "provider_trade_offer_assets"("playerId");
CREATE INDEX "provider_trade_offer_assets_offerId_assetType_idx" ON "provider_trade_offer_assets"("offerId", "assetType");

ALTER TABLE "provider_trade_offer_assets" ADD CONSTRAINT "provider_trade_offer_assets_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "provider_trade_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
