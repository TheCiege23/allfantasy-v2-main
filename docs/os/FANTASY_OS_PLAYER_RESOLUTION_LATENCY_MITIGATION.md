# Player Resolution Latency Mitigation (Phase 21)

**Status: implemented, additive, rollback-gated. Default OFF.**

**Phase 22 update:** coverage extended to `getPlayersByTeam()` and `getPlayerNews()` (new trigger sources `get_players_by_team_miss` on the existing sport-keyed coordinator state, and a new `requestPlayerNewsRefresh()` on separate news-keyed state within the same module — no second coordinator built). `getPlayersByTeam()` was found to have **zero real live callers** anywhere in the app this phase (correcting an earlier Call Graph doc claim), so it was validated via unit tests only, not real traffic. A real, honest limitation was found and disclosed during the Phase 22 soak: cross-route single-flight/cooldown sharing is not reliable in `next dev` mode across a route's first compilation — the "single-flight per process" claim below should be read as "reliable within concurrent requests to an already-warm route," not a blanket per-process guarantee. See [`FANTASY_OS_PLAYER_LOOKUP_SOAK_VALIDATION.md`](FANTASY_OS_PLAYER_LOOKUP_SOAK_VALIDATION.md) for full detail.

**Phase 23 update:** added `coordinatorInstanceId`/`pid` instrumentation to every log line and proved definitively (real `next build`/`next start` test) that the Phase 22 cross-route anomaly was a `next dev`-only compilation artifact — within one process, `player-search` and `player-detail` share the identical coordinator module instance and dedup correctly. The narrower, now-precise open question is whether Vercel's actual production deployment runs these routes in a shared process at all (unresolved, no live Vercel access this session). Also found (disclosed, not fixed) a real coverage gap: `lib/data/news.ts`'s `getLatestNews()`/`getHighImpactNews()` have real live callers and remain entirely unguarded. See [`FANTASY_OS_IMPORT_COORDINATOR_RUNTIME_SCOPE.md`](FANTASY_OS_IMPORT_COORDINATOR_RUNTIME_SCOPE.md) and [`FANTASY_OS_IMPORT_COORDINATOR_PRODUCTION_DESIGN.md`](FANTASY_OS_IMPORT_COORDINATOR_PRODUCTION_DESIGN.md) for full detail.

## What changed

Phase 20 found that `getPlayer()`/`searchPlayers()` (`lib/data/players.ts`) synchronously `await` a full per-sport `runSportsDataImporter()` run on a true cache miss — a real, measured 90–190 second operation — before returning a response to the customer request that triggered it. Phase 21 adds a narrow, flag-gated guardrail that removes this synchronous wait from the two named incidental-lookup functions, without touching the importer itself, without changing any response schema, and without affecting any explicit/administrative import caller.

## New module: `lib/workers/sports-data-import-coordinator.ts`

Exports `requestPlayerImportRefresh(sport, triggerSource)` — a fire-and-forget function (returns `void`, never throws) providing:

- **Single-flight**: at most one `runSportsDataImporter({sports:[sport]})` call in flight per sport per process. Concurrent callers for the same sport observe (join) the same in-flight promise instead of starting a duplicate import.
- **Per-sport independence**: keyed by sport string; one sport's in-flight/cooldown state never affects another sport.
- **Cooldown**: after an attempt (success or failure) completes, further requests for that sport are suppressed for `REFRESH_COOLDOWN_MS = 5 minutes`. Rationale: 5 minutes comfortably exceeds the worst real measured single-sport import latency (89.8s–189.2s across Phases 19–21), so a slow/failed attempt has time to fully resolve before a retry is allowed, while remaining far shorter than the 6-hour player-data TTL — a genuinely new/mistyped lookup becomes retryable again well within the same user session.
- **Failure containment**: importer rejections are caught, logged, and clear the in-flight/dedup state — a failure never permanently blocks future attempts (only the 5-minute cooldown applies).
- **Observability**: `console.log('[sports-data-import-coordinator]', JSON.stringify({event, sport, triggerSource, ...}))` for `refresh_started`, `refresh_joined`, `refresh_suppressed_cooldown`, `refresh_completed` (includes `durationMs`, `imported`), `refresh_failed` (includes `durationMs`, `error`). No player names, user data, tokens, or credentials are logged — only sport, trigger source, and timing/counts.

This module reuses the same proven contract as the existing `triggerBackgroundRefresh()` (`lib/data/shared.ts`) — fire-and-forget, deduped-by-key, error-contained — extended with a cooldown, since `runSportsDataImporter` is a materially more expensive operation (90–190s) than the smaller injury/news refreshes `triggerBackgroundRefresh` was originally built around.

**Explicit limitation, disclosed as required**: this guard is **process-local only**. It does not coordinate across multiple server instances or regions — a concurrent miss on a different instance can still start its own independent import for the same sport. It only prevents duplicate fan-out *within a single process*, which is where the real, measured amplification risk lives (Phase 20 found up to 6 parallel `searchPlayers()` calls from one `runUnifiedOrchestration()` request — all within one process/request lifecycle).

## Changed behavior: `getPlayer()` / `searchPlayers()` (`lib/data/players.ts`)

Gated by `process.env.PLAYER_LOOKUP_NON_BLOCKING_REFRESH === 'true'`.

### `getPlayer()` cache hit
Unchanged in both flag states — returns the cached row immediately; a stale-but-present row still triggers the pre-existing `triggerBackgroundRefresh()` path unchanged.

### `getPlayer()` cache miss
| | Flag OFF (default) | Flag ON |
|---|---|---|
| Behavior | Unchanged: `await runSportsDataImporter(...)`, re-query, return result (may still be `null`) | Calls `requestPlayerImportRefresh(sport, 'get_player_miss')` (fire-and-forget), returns `null` immediately |
| Latency on true miss | 90–190s (measured) | ~2–4s (measured, this phase) |
| Response shape | `SportsPlayerRecord \| null` | `SportsPlayerRecord \| null` (same type; miss case now always resolves as `null` on the *triggering* request rather than potentially resolving to the freshly-imported row) |

### `searchPlayers()` empty result
Same pattern: flag OFF preserves the exact prior synchronous-await-then-requery behavior; flag ON returns the empty array immediately and kicks off `requestPlayerImportRefresh(sport, 'search_players_miss')` in the background.

**Disclosed, intentional behavior change when the flag is ON**: a customer whose lookup causes the *first-ever* miss for a brand-new/mistyped player will get an honest "not found"/empty response on that specific request, rather than (as before) potentially waiting 90–190s and getting the newly-imported data back on the same request. The data becomes available on a subsequent request once the background import completes. This is the exact, deliberate trade-off the Phase 21 brief specifies: "A player lookup may trigger data refresh, but the initiating customer request must not block for minutes waiting for that refresh." Response *shape*/type is unchanged in both states; response *timing and content* for the specific triggering request differs, as documented above — not claimed to be byte-identical.

## Explicit import workflows — confirmed unmodified

`app/api/cron/import-players/route.ts`, `lib/fantasy-data/importNflFantasyData.ts`, `lib/fantasy-data/importNcaafFantasyData.ts`, and `lib/admin-dashboard/AdminSportsSyncService.ts` all call `runSportsDataImporter()` directly and were not touched. They continue to await full completion, exactly as before.

`getPlayersByTeam()` and `getPlayerNews()` (`lib/data/players.ts`) shared the same synchronous-miss pattern and were **deliberately left unchanged in Phase 21** — that phase's brief scoped explicitly to `getPlayer()`/`searchPlayers()`. **Phase 22 closes this gap.**

### `getPlayersByTeam()` (Phase 22)

Same shape as `searchPlayers()`: flag OFF preserves the exact prior synchronous-await-then-requery behavior; flag ON returns the empty array immediately and calls `requestPlayerImportRefresh(sport, 'get_players_by_team_miss')` (reuses the existing sport-keyed coordinator state and cooldown — no separate state). **Zero real live callers found this phase** (verified by grepping every file that imports from `lib/data/players`) — validated via unit tests only, not real HTTP traffic. Response ordering/shape confirmed unchanged via test.

### `getPlayerNews()` (Phase 22)

Structurally different: its miss path calls `runNewsImporter()`, not `runSportsDataImporter()` — a genuinely separate importer with its own cost profile (one external call per sport vs. three, no chunked upsert loop) and no sport argument available at the call site (a `playerId` lookup doesn't carry a known sport). Flag OFF preserves the exact prior behavior. Flag ON calls the new `requestPlayerNewsRefresh('get_player_news_miss')`, which lives in the same coordinator module but uses its own separate in-flight/cooldown `Map`s (keyed by a fixed constant, since `runNewsImporter()` always covers all sports at once, matching pre-Phase-22 semantics exactly). Real soak measurement: 2,193ms and 1,674ms per completion — confirming this path is materially cheaper than the player-data importer.

## Feature flag: `PLAYER_LOOKUP_NON_BLOCKING_REFRESH`

- **Unset / any value other than `'true'` (default)**: exact prior behavior restored — synchronous await, no coordinator involvement, no API contract changes.
- **`'true'`**: non-blocking guardrail active on `getPlayer`/`searchPlayers` miss paths; single-flight + cooldown protection active; refresh telemetry emitted.
- **Default chosen as OFF**, consistent with every other behavior-changing flag introduced across this Fantasy OS effort (`SHARED_SERVICES_WAIVER_SHADOW_COMPARE`, `SHARED_SERVICES_TRADE_SHADOW_COMPARE`) — this flag changes production behavior of a live, widely-used authoritative function (not a shadow-only addition), so it follows the same "prove it, then flip it on deliberately" discipline rather than defaulting to the new behavior.
- **Rollback**: unset the flag (or set to any non-`'true'` value). No code revert needed. No schema involved.

## Real before/after latency evidence (this phase, `.env.test`, isolated dev server)

| Scenario | Flag OFF (from Phase 19/20 real measurements — code path unchanged, byte-identical, confirmed by passing regression test) | Flag ON (measured live this phase) |
|---|---|---|
| Cache hit (warm) | 4.1s (Phase 20) | 1.9–2.2s |
| `searchPlayers` true miss, single sport (NBA) | ~90s (Phase 20, NBA/general true-miss case) | **2.46s** |
| `getPlayer` true miss (player-detail route) | 89.8s (Phase 20) | **2.36s**; background import completed independently in 86.5s (`durationMs:86519`, `imported:3488`), never observed by the triggering request |
| `/api/trade-value/analyze`, unresolved `playerId` asset | 170–189s (Phase 19) | **9.8s**, same honest `"Could not price assets on both sides."` / `VALIDATION` / 400 response the old path would also eventually produce |
| 3 truly concurrent `searchPlayers` misses, same sport (NHL) | N/A (not previously measurable — old code had no dedup) | All 3 returned in 3.4–3.6s; server log confirms exactly 1 `refresh_started` + 2 `refresh_joined` + 1 `refresh_completed` (imported 202 NHL players in 11.2s) |
| 2 concurrent misses, different sports (NHL + MLB) | N/A | Both proceeded independently — NHL's cooldown from a prior request did not block MLB's fresh `refresh_started` |
| Repeat miss within cooldown window | N/A | Correctly suppressed (`refresh_suppressed_cooldown`, `msSinceLastAttempt:143333`) |

The flag-OFF "before" figures reuse Phase 19/20's real measurements rather than re-paying the 90–190s cost again this phase, because the flag-OFF code path is provably byte-identical to the pre-Phase-21 code (confirmed both by direct diff and by a passing unit test asserting the old synchronous-await behavior is preserved when the flag is unset).

## Response fidelity

- **Cache-hit path**: zero code change in either flag state — byte-identical by construction.
- **Miss path, flag OFF**: byte-identical to pre-Phase-21 code — confirmed by diff and by test.
- **Miss path, flag ON**: response *type*/*shape* unchanged (`SportsPlayerRecord | null`, `SportsPlayerRecord[]`); response *content* for the triggering request differs as disclosed above (immediate honest miss vs. a possible same-request success after a long wait). Verified live for `/api/trade-value/player-detail` (404/"Not found" — same error shape old code produces for a genuine miss), `/api/trade-value/player-search` (empty array), and `/api/trade-value/analyze` (`VALIDATION`/400/"Could not price assets on both sides." — same branch old code would also eventually reach).
- **Background-failure isolation**: `requestPlayerImportRefresh` never throws and is never awaited by the caller — a rejected importer promise is caught internally and only surfaces as a `refresh_failed` log line. Verified by a dedicated unit test asserting the caller path completes normally even when the mocked importer rejects.

## Remaining distributed-systems limitations (disclosed, not solved this phase)

- The single-flight/cooldown guard is process-local, not a cross-instance lock. Under real multi-instance deployment, the same sport could be imported concurrently by more than one instance. This does not make anything worse than the pre-Phase-21 state (which had zero coordination at any level) — it only closes the largest single-process amplification risk found in Phase 20.
- `getPlayersByTeam()` and `getPlayerNews()` still block synchronously on a true miss — same risk class, intentionally out of scope this phase.
- The importer's own internal cost (up to 18 sequential external calls per sport on a full miss) is unchanged — this phase makes the customer stop waiting for it, not makes it faster.

## Remaining importer performance work (future phase candidate)

A bounded timeout around individual external-provider calls inside `fetchWithChain` (`lib/workers/api-chain.ts`) remains the most impactful *next* improvement, but was explicitly not attempted this phase (Phase 20 already classified it as higher correctness risk — it could change which provider's data is used for unrelated, currently-fine requests, a broader behavior change than this phase's scope).
