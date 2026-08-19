# News Import Coverage Audit (Phase 24)

**Status: gap found in Phase 23, closed this phase. Option B selected (extend the existing coordinator).**

## The gap (disclosed Phase 23, closed this phase)

`lib/data/news.ts`'s `getLatestNews()` and `getHighImpactNews()` had real, live, production callers and synchronously `await runNewsImporter({sports:[sport]})` on a cache miss — completely outside anything the Phase 21/22 coordinator guarded, even though the underlying importer (`runNewsImporter`) and risk class (90-190s-class stalls, same unbounded provider-fallback chain Phase 20 audited) are identical to what `lib/data/players.ts`'s `getPlayerNews()` already had fixed in Phase 22.

## Complete call graph

| Function | File | Real production callers | Miss-path behavior (before this phase) | Miss-path behavior (this phase) |
|---|---|---|---|---|
| `getLatestNews(sport, limit)` | `lib/data/news.ts:8` | `app/api/leagues/[leagueId]/draft/assistant-context/route.ts` (line 47), `lib/ai-orchestration/sports-context-enricher.ts` (line 397), `lib/chimmy/chimmy-sport-data-digest.ts` (line 145) | Synchronous, unguarded `await runNewsImporter({sports:[sport]})` | Flag-gated non-blocking via `requestSportNewsRefresh(sport, 'get_latest_news_miss')` |
| `getHighImpactNews(sport)` | `lib/data/news.ts:55` | `lib/ai-orchestration/sports-context-enricher.ts` (line 366) | Synchronous, unguarded `await runNewsImporter({sports:[sport]})` | Flag-gated non-blocking via `requestSportNewsRefresh(sport, 'get_high_impact_news_miss')` |
| `getPlayerNews(playerId)` (this file, distinct from `lib/data/players.ts`'s same-named function) | `lib/data/news.ts:30` | **None found** — confirmed again this phase, no import path resolves to this specific function | Still synchronous/unguarded — **left untouched**, see below |

## Cache behavior (unchanged, confirmed)

All three functions share the same shape: query `PlayerNewsRecord`, on 0 rows attempt a real refresh; on stale-but-present rows (`DATA_TTLS.news` = 30 minutes), trigger the existing `triggerBackgroundRefresh()` (already non-blocking, unrelated to this coordinator, unchanged). Only the **true-miss** path changes.

## Feature-flag behavior

Reuses `PLAYER_LOOKUP_NON_BLOCKING_REFRESH` exactly — no second flag introduced, per this phase's explicit requirement. Default OFF: both functions behave byte-identically to before. `'true'`: both return immediately on miss and request a background refresh.

## Overlap with the Phase 21/22 coordinator

`getLatestNews`/`getHighImpactNews` are **sport-scoped** (`runNewsImporter({sports:[sport]})`), unlike `getPlayerNews`'s **all-sports** call (`runNewsImporter()`, no argument). The new `requestSportNewsRefresh(sport, triggerSource)` function reuses the exact same `newsInFlightRefresh`/`newsLastAttemptAt` `Map`s `requestPlayerNewsRefresh` already used, keyed by the real sport string instead of the fixed `'all-sports-news'` constant — the two key spaces coexist safely in the same maps without collision (no real sport code equals that constant). No second coordinator, no new state structure, same cooldown constant (`NEWS_REFRESH_COOLDOWN_MS`), same logging shape (`logRefreshEvent`), same rollback mechanism (the one shared flag).

## Decision: Option B — extend the existing coordinator

**Chosen over Option A (leave unguarded)** because:
- The risk is real (confirmed live callers) and identical in class to what was already fixed for `getPlayerNews` — leaving it unguarded while its sibling function is protected is an inconsistent, arbitrary gap, not a considered scope boundary.
- The fix is provably low-risk: it mirrors Phase 22's exact, already-proven pattern (same flag, same telemetry, same rollback, tests-first), not a new abstraction.
- Per this phase's mission ("no remaining architectural uncertainty… this infrastructure should be considered complete"), leaving a known, live gap unaddressed would contradict that closure goal when the fix costs almost nothing beyond Phase 22's already-validated approach.

## What was deliberately NOT touched

`lib/data/news.ts`'s own `getPlayerNews(playerId)` (line 30) remains unguarded. This is intentional, not an oversight: it has zero real callers (reconfirmed this phase), so guarding it would add code with no live risk to mitigate. If a future caller is ever added, this is the one remaining loose end to close using the identical `requestSportNewsRefresh`-style pattern (though it would need an all-sports variant, mirroring `requestPlayerNewsRefresh`, since it calls `runNewsImporter()` with no sport argument, identical to `lib/data/players.ts`'s `getPlayerNews`).
