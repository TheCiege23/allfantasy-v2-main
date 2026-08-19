# Shared Resolver Performance Validation (Phase 28)

**Status: query count and structural cost assessed. No new query added this phase — only the SELECT shape of the existing Phase 27 ADP query changed.**

## Query count — unchanged from Phase 27

Phase 28 did **not** add a new query. It modified `loadAdpRelevantPlayerKeys()` (renamed `loadAdpRankByPlayerKey()`) to select one additional column (`averageOverallPick`) from the *same* `AllFantasyAdpSnapshot` query Phase 27 already introduced, and removed the `distinct: ['playerKey']` clause (replaced by in-memory best-rank aggregation, since `distinct` cannot be combined with selecting a value to aggregate across duplicates). Total queries per call: still 2 (`sportsPlayer.findMany` + `allFantasyAdpSnapshot.findMany`), unchanged from Phase 27.

## Row volume change

Removing `distinct` means the ADP query may now return one row per (playerKey, context) combination instead of one row per distinct playerKey — for NFL, this is the real measured 549 total rows (vs. 354 distinct playerKeys previously fetched). A real, modest increase in row volume for this specific query (still small relative to the dominant `sportsPlayer.findMany` cost, which fetches thousands of rows).

## Memory impact

The `Map<string, number>` built from these rows is bounded by the same real distinct-playerKey counts already established (354 for NFL) — the aggregation logic (`if (current === undefined || rank < current)`) collapses duplicate-context rows down to one entry per player, so final memory footprint is unchanged from Phase 27 despite the larger intermediate row count.

## Latency

Not independently re-isolated this phase from the Phase 27 estimate (a small, fast query against a ~1,431-row table). No real regression signal was observed during this phase's real `.env.test` testing (all measurements completed in the same few-second range as prior phases' real Neon round-trips).

## Cache effectiveness

Unchanged — no caching exists in this resolver, before or after any of Phases 26-28's changes.

## Conclusion

No new infrastructure, no new query, no meaningful new cost center. The only real change is a modest row-volume increase in an already-small, already-fast query, with output size (the resulting Map) unchanged.
