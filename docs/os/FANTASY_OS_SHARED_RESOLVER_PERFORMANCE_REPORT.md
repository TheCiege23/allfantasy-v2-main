# Shared Resolver Performance Report (Phase 27)

**Status: real measurement where captured; estimated impact clearly labeled where an isolated before/after wasn't captured.**

## Real measured latency (post-fix, full real call through `.env.test`)

| Operation | Real measured time |
|---|---|
| `getPlayerPoolForLeague(leagueId, 'NFL', {limit: 800})`, post-Phase-27-fix, real Neon connection | 2,951ms |

This includes real network round-trip latency to the `.env.test` Neon database from this environment (established throughout this whole effort as a real, non-trivial cost — consistent with other phases' measurements against the same database).

## Query count change

| | Before this phase | After this phase |
|---|---|---|
| Queries per call | 1 (`sportsPlayer.findMany`) | **2** (`sportsPlayer.findMany` + `allFantasyAdpSnapshot.findMany`, the new ADP-relevance lookup) |

**One additional query per call.** The new query selects only `playerKey` (a single indexed-scale string column) with `distinct`, against a table measured at 1,431 total real rows — a small, fast query by construction, not a scan of a large table. This was not isolated and measured separately from the full end-to-end latency above (which is dominated by real network round-trips to Neon in this environment) — reported as a reasoned expectation based on the table's real measured size, not an independently measured number.

## Memory

No new unbounded in-memory structure was introduced. The new `Set<string>` built from the ADP query is bounded by the real, measured distinct-playerKey count for a sport (354 for NFL, 932 across all sports combined) — trivial memory cost relative to the `SportsPlayer` row set already being held in memory by the existing (Phase 26-fixed) fetch-all-then-dedupe logic.

## Cache effectiveness

No caching exists in this resolver before or after this phase's change (confirmed absent in both the Phase 25 Draft Performance Audit and this phase's fresh read) — this phase neither improved nor regressed cache behavior, since none exists at this layer. Callers with their own caching (e.g., `DraftPoolCache`, `lib/api-performance/cache.ts`) are unaffected — this resolver's return shape and contract are unchanged.

## Before vs. after — honest summary

The dominant cost in this function was always, and remains, the `sportsPlayer.findMany` fetch of all matching rows (fixed to be unbounded-by-limit in Phase 26) — a real, necessary cost to fix the underlying selection-quality defect. This phase's addition (one small, fast, bounded query) is a marginal incremental cost on top of that, not a new dominant cost center. No regression in overall responsiveness was observed in real testing, though an isolated, apples-to-apples before/after timing comparison of just the new query's own cost was not captured this phase — disclosed as an estimate, not a measurement.
