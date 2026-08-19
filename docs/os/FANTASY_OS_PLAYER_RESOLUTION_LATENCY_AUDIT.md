# Player Resolution Latency Audit & Mitigation Design (Phase 20)

**Status: audit and design only. No code changed. No mitigation implemented — see "Why no fix was implemented" below.**

## Summary

Phase 19 found that an unrecognized `playerId` in the Trade Value Console can stall the authoritative request for 170–189 real seconds. This phase traced the root cause to its full extent, measured it precisely, mapped its true blast radius across the app (much wider than Trade), and designed — but did not implement — a mitigation, per this phase's own explicit conditional scope ("only implement if the audit uncovers a narrowly scoped, low-risk fix").

## Importer behavior (read directly from source)

`runSportsDataImporter()` (`lib/workers/sports-data-importer.ts`), for **each** sport requested, does:

1. `loadIdentitySeeds()` — a real DB query, up to 5,000 rows from `PlayerIdentityMap`.
2. `fetchProviderPlayerSeeds()` — a real **external API call** via `apiChain.fetch({dataType:'players', ...})`.
3. Five more real DB queries (season stats, injuries, news, ADP, meta-trends — up to 2,500–4,000 rows each), run in parallel with #1–2.
4. Two more real **external API calls** — `apiChain.fetch({dataType:'projections'})` and `apiChain.fetch({dataType:'rankings'})`.
5. In-memory merge/build of a full player-row map from all of the above.
6. A **batched Prisma `$transaction` upsert** of every resulting row (chunks of 100) — potentially thousands of rows for a large sport like NFL or NCAAF.

**Each `apiChain.fetch()` call** (`lib/workers/api-chain.ts`'s `fetchWithChain`) itself tries up to **6 different external providers in sequence** (Rolling Insights → TheSportsDB → API-Sports → ClearSports → Sleeper → ESPN, order varies by data type) on a cache miss, with **no overall timeout** found anywhere in the chain or around individual provider calls. Combined with `runSportsDataImporter`'s 3 real external-fetch calls per sport, a single true cache miss can trigger **up to 18 sequential external HTTP calls** in the worst case before giving up.

**Confirmed intentional, not obviously a bug**: this is a genuine, deliberate "refresh this entire sport's player database" operation — not a lightweight single-player lookup. The severity comes from *when* it's triggered (synchronously, inline, on any true cache miss), not from what it does.

## Cache/refresh strategy (real, already-partially-mitigated)

- **Stale-but-present data**: handled well already. `triggerBackgroundRefresh()` (`lib/data/shared.ts`) is genuinely fire-and-forget (returns `void`, deduplicated via a `pendingRefreshes` Map) — the caller gets the stale row back immediately, never blocked.
- **True cache miss** (zero existing rows for that id/query): **synchronously awaited**, no fallback, no timeout. This is the real problem.
- **Pre-warming**: a 6-hour Vercel Cron (`/api/cron/import-players`) already keeps existing players fresh under normal operation — meaning the severe synchronous path is not the common case, but is real and reachable whenever a genuinely new/unseeded player or a typo/malformed input is looked up.

## Latency measurements (real, this phase)

| Scenario | Real measured latency |
|---|---|
| Cache hit, but past the 6-hour TTL (first request this session) | 54.6s — the route also calls `getPlayerNews`, which has its own independent, similarly-structured cache-miss/importer path; this measurement reflects the combined route, not `getPlayer` in isolation |
| Cache hit, warm (second identical request) | 4.1s |
| True cache miss (guaranteed-nonexistent id) | 89.8s |
| Phase 19's real cache-miss observations (2 separate real requests) | 170.4s and 185.8s |

All four real measurements (89.8s, 170.4s, 185.8s, and the 54.6s combined-route case) are consistent with the same root cause: one or more of the up-to-18 sequential external calls being slow, with no bound anywhere in the chain.

## Blast-radius classification

| Caller | Classification | Reasoning |
|---|---|---|
| `POST /api/trade-value/analyze` | **Synchronously blocked** | Confirmed directly (Phases 18–20); real user-controlled asset names/ids. |
| `GET /api/trade-value/player-search`, `GET /api/trade-value/player-detail` | **Synchronously blocked** | Direct, unmediated user input to `getPlayer`/`searchPlayers`. |
| `POST /api/ai-tools/trending-players/dashboard` | **Potentially blocked** | Per-row `getPlayer` calls are individually caught (`.catch(()=>null)`), so one slow player doesn't crash the whole dashboard, but each miss still adds up to ~90–190s to that row's resolution before the catch fires. |
| The 13+ routes reached via `runUnifiedOrchestration` (chimmy chat, `/api/ai/run`, `/api/ai/compare`, matchup-insight, explain/tell-story routes) | **Potentially blocked, amplified** | Up to 6 parallel `searchPlayers` calls per request — if multiple terms miss simultaneously, up to 6 concurrent full-sport reimports could fire for one request. No timeout wraps this call in `enrichEnvelopeWithSportsData`. |
| Waiver, Draft, Game Day, Commissioner shared services | **Unaffected** | Confirmed directly — none of these import `lib/data/players.ts`. |
| Cron/admin import routes | **Unaffected as a *caller-of-concern*** | These are *supposed* to run this exact expensive operation on a schedule/on-demand by an admin; that's their job, not a bug. |

**Customer impact estimate**: bounded to a real but narrower slice than "the whole app" — concentrated in Trade Value Console (3 routes, direct and confirmed) and the shared AI-orchestration layer (13+ routes, indirect, amplifiable up to 6x per request). Waiver, Draft, Game Day, and Commissioner — the four domains this Fantasy OS effort has built shared services for — are all confirmed unaffected.

## Mitigation options considered (design only)

| Option | Complexity | Rollback complexity | Correctness risk | Notes |
|---|---|---|---|---|
| Bounded timeout around `runSportsDataImporter()` inside `getPlayer`/`searchPlayers` | Low | Low (one wrapper, revertable) | **Medium** — changes what a currently-slow-but-eventually-successful request returns (would now fail/return null instead of eventually succeeding) |
| Negative caching (remember "this id doesn't exist" for N minutes) | Low | Low | Low — but a legitimately new player added mid-window would appear "not found" until the cache entry expires |
| Concurrency guard / request coalescing (dedupe simultaneous imports for the same sport, mirroring `triggerBackgroundRefresh`'s existing `pendingRefreshes` pattern) | Low–Medium | Low | **Very low** — this is the one option that changes nothing about *what* eventually happens, only prevents *redundant concurrent* work; directly addresses the "6 parallel searchPlayers calls" amplification risk with an already-proven pattern from the same file |
| Stale-while-revalidate for true misses (return a "not yet available" placeholder immediately, refresh in background) | Medium | Medium | Medium — requires every caller to handle a new "pending" response shape, a real API-contract change |
| Circuit breaker on the external-provider chain | Medium–High | Medium | Medium — needs careful tuning to avoid false-tripping during real transient provider slowness |
| Per-provider timeout inside `fetchWithChain` | Medium | Medium | **Medium–High** — could change *which* provider's data ends up being used for entirely unrelated, currently-fine requests, a real customer-visible behavior change across the whole app, not just Trade |

## Recommended approach (design, not implemented)

**Request coalescing / concurrency guard**, reusing the exact pattern already proven safe in this same file (`triggerBackgroundRefresh`'s `pendingRefreshes` Map): before calling `runSportsDataImporter({sports:[sport]})` inside `getPlayer`/`searchPlayers`, check for an in-flight import for that sport and `await` the existing promise instead of starting a new one. This is the only option in the table with **very low** correctness risk — it changes *when* redundant work is skipped, never *what* data is ultimately returned or how long a genuinely-first miss takes. It directly closes the most amplifiable part of the risk (the 6-parallel-`searchPlayers` orchestration path) without touching response semantics anywhere.

**A bounded timeout is a reasonable second-priority follow-up**, but was not recommended for implementation this phase because it necessarily changes customer-visible behavior for the affected slice of requests (eventual success → fast failure) — a real, deliberate product/UX tradeoff that deserves its own explicit decision, not a decision made inside a latency-audit phase.

## Why no fix was implemented this phase

Per this phase's explicit conditional scope: a code change should only be made "if the audit uncovers a narrowly scoped, low-risk fix that can be proven not to alter existing behavior." Even the lowest-risk option found (request coalescing) touches a function used by **13+ live routes across the whole app**, most of which are outside any Fantasy OS shared-service boundary this effort has built or tested. Implementing and validating it responsibly would require its own dedicated verification pass across all of those callers — a scope this audit phase was not built to carry out safely in the same sitting as the audit itself. This is the outcome the brief's own structure explicitly anticipates and permits ("otherwise, stop at the design stage").

## What this phase did NOT do

- Did not modify `lib/data/players.ts`, `lib/workers/sports-data-importer.ts`, or `lib/workers/api-chain.ts`.
- Did not add a timeout, circuit breaker, or any other runtime behavior change.
- Did not touch any Fantasy OS shared-service code (Waiver, Trade, Draft, Game Day, Commissioner, Player Identity) — confirmed unaffected by this whole investigation.

## Phase 21 update

Phase 21 implemented the request-coalescing/concurrency-guard recommendation above, in `lib/workers/sports-data-import-coordinator.ts`, gated by `PLAYER_LOOKUP_NON_BLOCKING_REFRESH` (default OFF). One deliberate evolution beyond what was sketched here: this recommendation described the caller still `await`-ing the joined in-flight promise (dedup only); Phase 21's actual brief required the *initiating* request to not block at all, so the implemented guard is fire-and-forget from `getPlayer`/`searchPlayers`' perspective — both the dedup benefit described here and the non-blocking behavior are achieved together. Full detail, real before/after measurements, and response-fidelity evidence: [`FANTASY_OS_PLAYER_RESOLUTION_LATENCY_MITIGATION.md`](FANTASY_OS_PLAYER_RESOLUTION_LATENCY_MITIGATION.md).

## Phase 22 update

Extended the same guardrail to `getPlayersByTeam()`/`getPlayerNews()` and ran an extended real soak. Two corrections to this audit's own earlier claims, found and disclosed during Phase 22: (1) `getPlayersByTeam()` has **zero real callers** anywhere in the live app — the blast-radius table above should be read with that row understood as currently dormant risk, not active; (2) the single-flight/cooldown guarantee is **not** reliably cross-route in `next dev` mode on a route's first compilation (proven via a controlled test isolating the cause) — the guard reliably protects concurrent requests to an already-warm route/process, which is narrower than "per process" as originally written above. Neither finding changes the core conclusion (customer requests no longer block on the importer) — both are scope corrections to the secondary dedup guarantee. Full soak evidence: [`FANTASY_OS_PLAYER_LOOKUP_SOAK_VALIDATION.md`](FANTASY_OS_PLAYER_LOOKUP_SOAK_VALIDATION.md).

## Phase 23 update

Ran the definitive follow-up to (2) above: a real `next build`/`next start` production-mode test (not just `next dev`) proved the Phase 22 cross-route anomaly was purely a dev-mode compilation artifact — within one running process (dev or production build), `player-search` and `player-detail` share the exact same coordinator module instance (proven via new `coordinatorInstanceId`/`pid` instrumentation), and dedup/cooldown work perfectly across routes. The one remaining open question is architectural, not logical: whether Vercel's actual production deployment runs these routes in one shared process at all — a question this phase could not resolve without live Vercel deployment access (Vercel MCP was not authorized this session). Also found a real, previously-undocumented gap: `lib/data/news.ts`'s `getLatestNews()`/`getHighImpactNews()` have real live callers and remain completely unguarded by any coordinator work through this phase. Full detail: [`FANTASY_OS_IMPORT_COORDINATOR_RUNTIME_SCOPE.md`](FANTASY_OS_IMPORT_COORDINATOR_RUNTIME_SCOPE.md) and [`FANTASY_OS_IMPORT_COORDINATOR_PRODUCTION_DESIGN.md`](FANTASY_OS_IMPORT_COORDINATOR_PRODUCTION_DESIGN.md).
