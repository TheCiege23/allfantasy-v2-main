-- Two indexes for the /core Trades screen's history reads. Written 2026-11-06 (#3310) and parked in
-- prisma/migrations-pending/ as 20261106150000_trade_history_indexes; moved here 2026-11-14 on the
-- owner's instruction, after the post-deploy drift check reported both declared indexes missing in
-- production. Renamed to a timestamp after the last applied migration so it applies in order.
-- Nothing in the code depends on them: every query below runs the same without them, only slower.
-- Check dw_transaction_facts' size first: `railway run node scripts/check-table-sizes.mjs`.
--
-- ── WHAT EACH ONE IS FOR, BY THE QUERY THAT USES IT ─────────────────────────────────────────
--
-- 1. "dw_transaction_facts" ("leagueId", "type", "season", "weekOrPeriod")
--    lib/core-app/trades.ts, `readTradesSections`, the non-Sleeper history:
--      WHERE "leagueId" = $1 AND "type" = 'trade'
--      ORDER BY "season" DESC, "weekOrPeriod" DESC  LIMIT 400
--    The existing ("leagueId", "createdAt") index narrows to the league but then reads EVERY fact
--    the league has — waivers, adds, drops — to filter to trades and sort them. This one answers the
--    filter and the order together (a backward scan gives DESC NULLS FIRST, which is what Prisma's
--    `desc` asks for), so the read stops after 400 trade rows.
--
-- 2. "LeagueTrade" ("transactionId")
--    lib/core-app/trades.ts, the same history read, naming each trade's players:
--      WHERE "transactionId" IN (...) OR "historyId" IN (<this league's histories>)
--    and app/api/trades/impact-now/route.ts: WHERE "transactionId" = $1 AND <history join>.
--    The only index containing "transactionId" is the unique ("historyId", "transactionId"), whose
--    leading column is "historyId", so it cannot serve a lookup by transaction id — and one unindexed
--    branch of an OR makes the whole OR a sequential scan of LeagueTrade.
--
-- ── CONSIDERED AND LEFT OUT ─────────────────────────────────────────────────────────────────
--
-- "LeagueTrade" ("historyId", "tradeDate"): the grade list (`resolveGrades`) filters
-- `"historyId" IN (several)` and orders by tradeDate, season, week, historyId. With an IN list over
-- several histories the index cannot hand back one global order, the existing ("historyId") index
-- already serves the filter, and one league's rows number in the hundreds — the sort is not the cost.
--
-- ── WHAT THESE DO NOT FIX ───────────────────────────────────────────────────────────────────
--
-- Neither is on the SLEEPER history path, which is the 19–30s section. That path reads a
-- `sportsDataCache` row by primary key and the frozen grades through their own index; its cost was
-- the grading, addressed in code alongside this file.
--
-- ── COST ────────────────────────────────────────────────────────────────────────────────────
--
-- Plain CREATE INDEX (not CONCURRENTLY: Prisma Migrate wraps a migration in a transaction, and
-- CONCURRENTLY refuses to run inside one). LeagueTrade held ~15.4k rows on 2026-09-16 (the count in
-- lib/core-app/trades.ts), so its build is brief. dw_transaction_facts was NOT measured for this
-- change — check its size before applying; if it is large enough for the build's write lock to
-- matter, apply that index on its own with CONCURRENTLY outside a transaction.

CREATE INDEX IF NOT EXISTS "dw_transaction_facts_leagueId_type_season_weekOrPeriod_idx"
  ON "dw_transaction_facts" ("leagueId", "type", "season", "weekOrPeriod");

CREATE INDEX IF NOT EXISTS "LeagueTrade_transactionId_idx"
  ON "LeagueTrade" ("transactionId");
