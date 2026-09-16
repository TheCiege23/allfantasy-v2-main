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
-- ⚠ `status = 'vanished'` IS NOT `'expired'`. An offer that stops appearing without a terminal
-- state may have been withdrawn, expired, or missed by a rate-limited sweep. `expired` is reserved
-- for a provider that says so. No CHECK constraint pins the vocabulary: a provider adding a status
-- should surface as an unmapped value to look at, not as a failed insert that drops the row.

CREATE TABLE "provider_trade_offers" (
  "id"                     TEXT         NOT NULL,
  "leagueId"               VARCHAR(64)  NOT NULL,
  "provider"               VARCHAR(16)  NOT NULL,
  "providerTradeId"        VARCHAR(128) NOT NULL,
  "sport"                  VARCHAR(12)  NOT NULL,
  "season"                 INTEGER,
  "weekOrPeriod"           INTEGER,
  "status"                 VARCHAR(16)  NOT NULL,
  "providerStatus"         VARCHAR(32),
  "proposedByRosterId"     VARCHAR(64),
  "rosterIds"              TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  "consentedRosterIds"     TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  "proposedAt"             TIMESTAMP(3),
  "respondedAt"            TIMESTAMP(3),
  "expiresAt"              TIMESTAMP(3),
  "firstSeenAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"             TIMESTAMP(3) NOT NULL,
  "payload"                JSONB,

  CONSTRAINT "provider_trade_offers_pkey" PRIMARY KEY ("id")
);

-- The provider's own id is the idempotency key. Scoped by league as well as provider because
-- `dw_transaction_facts` already carries a primary key that omits the league, and that omission is
-- recorded in this repo as a hazard rather than a pattern to copy.
CREATE UNIQUE INDEX "uniq_provider_trade_offer"
  ON "provider_trade_offers" ("provider", "leagueId", "providerTradeId");

-- "Needs you" and the pending/sent/completed buckets are all league + status reads.
CREATE INDEX "provider_trade_offers_league_status_idx"
  ON "provider_trade_offers" ("leagueId", "status");

-- Sweep bookkeeping: which offers in this league were NOT seen in the latest pass.
CREATE INDEX "provider_trade_offers_league_status_last_seen_idx"
  ON "provider_trade_offers" ("leagueId", "status", "lastSeenAt");

CREATE INDEX "provider_trade_offers_league_season_week_idx"
  ON "provider_trade_offers" ("leagueId", "season", "weekOrPeriod");

CREATE TABLE "provider_trade_offer_assets" (
  "id"                     TEXT        NOT NULL,
  "offerId"                TEXT        NOT NULL,
  "assetType"              VARCHAR(16) NOT NULL,
  "playerId"               VARCHAR(64),
  "pickSeason"             INTEGER,
  "pickRound"              INTEGER,
  "pickOriginalRosterId"   VARCHAR(64),
  "faabAmount"             INTEGER,
  "fromRosterId"           VARCHAR(64),
  "toRosterId"             VARCHAR(64),
  "metadata"               JSONB,

  CONSTRAINT "provider_trade_offer_assets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "provider_trade_offer_assets_offer_idx"
  ON "provider_trade_offer_assets" ("offerId");

-- Read-time join to canonical player identity; the provider id is stored, never rewritten.
CREATE INDEX "provider_trade_offer_assets_player_idx"
  ON "provider_trade_offer_assets" ("playerId");

CREATE INDEX "provider_trade_offer_assets_offer_type_idx"
  ON "provider_trade_offer_assets" ("offerId", "assetType");

-- CASCADE because an asset has no meaning without its offer, and the offer is a mirror of provider
-- state rather than a record anyone here authored — re-syncing recreates it.
ALTER TABLE "provider_trade_offer_assets"
  ADD CONSTRAINT "provider_trade_offer_assets_offerId_fkey"
  FOREIGN KEY ("offerId") REFERENCES "provider_trade_offers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
