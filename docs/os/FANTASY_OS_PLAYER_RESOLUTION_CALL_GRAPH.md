# Player Resolution — Full Caller Graph (Phase 20)

**Status: audit only. No code changed this phase.**

**Phase 24 update:** the `lib/data/news.ts` gap disclosed in the Phase 23 addendum below (`getLatestNews`/`getHighImpactNews` unguarded) is now closed — both covered by the coordinator via `requestSportNewsRefresh()`, same flag, tests-first. Full detail: [`FANTASY_OS_NEWS_IMPORT_COVERAGE_AUDIT.md`](FANTASY_OS_NEWS_IMPORT_COVERAGE_AUDIT.md). Production readiness for the whole guardrail is now finalized at **A — Ready**: [`FANTASY_OS_PRODUCTION_READINESS_REPORT.md`](FANTASY_OS_PRODUCTION_READINESS_REPORT.md).

This document traces every real caller of `lib/data/players.ts`'s `getPlayer()`/`searchPlayers()` and `lib/workers/sports-data-importer.ts`'s `runSportsDataImporter()`, found by direct source search — not inferred from filenames.

## Direct callers of `getPlayer()` / `searchPlayers()`

| Caller | Function | Call-site type | User-controllable input? |
|---|---|---|---|
| `app/api/trade-value/player-search/route.ts` | `searchPlayers(q, sport)` | Live API route, `GET` (rate-limited 80/min/IP) | **Yes** — raw query-string `q`/`sport`, only validated for `q.length >= 2`. |
| `app/api/trade-value/player-detail/route.ts` | `getPlayer(id)` | Live API route, `GET` (rate-limited 40/min/IP) | **Yes** — raw query-string `id`, passed straight through. |
| `lib/trade-value-console/runTradeConsoleAnalysis.ts` | `getPlayer`, `searchPlayers` | Shared-service module, reached via `POST /api/trade-value/analyze` | **Yes** — `playerId`/`name` come from the request body's asset arrays (up to 24 assets/side × 2 sides). |
| `lib/trade-value-console/roster-context-loader.ts` | `getPlayer(id)` | Only called from within `runTradeConsoleAnalysis.ts` | Indirect — reachable from the same `/api/trade-value/analyze` traffic. |
| `lib/trending-players/runTrendingDashboard.ts` | `getPlayer(row.playerId)`, per-row loop (`.catch(()=>null)` per call) | Shared-service, reached via `POST /api/ai-tools/trending-players/dashboard` | Semi-indirect — `row.playerId` is DB-derived, but which rows get looked up is influenced by user-controlled request filters. |
| `lib/ai-orchestration/sports-context-enricher.ts` | `searchPlayers(term, sport)`, **up to 6 parallel terms per request** via `Promise.all` | Shared orchestration module, unconditionally called (try/catch only, **no timeout**) from `runUnifiedOrchestration()` | Semi-indirect — triggered whenever `featureType` matches trade/waiver/draft/comparison/trend keywords; search terms are extracted from server-assembled payloads (often real roster/lineup data), not raw free text. |

`getPlayersByTeam`/`getPlayerNews` (same file) independently trigger `runSportsDataImporter`/`runNewsImporter` on their own cache-miss paths. Same blocking-on-miss pattern, a different importer — out of this document's direct scope but sharing the same underlying risk class.

**Phase 22 correction**: the caller list above for this row (`app/api/start-sit/injuries`, `app/api/leagues/[leagueId]/draft/assistant-context`, `lib/ai-tools-start-sit/*`, `lib/chimmy/chimmy-sport-data-digest.ts`) was **wrong** — verified fresh this phase via `grep -rn "getPlayersByTeam" app lib` (zero matches) and by listing every file that imports anything from `lib/data/players` (11 files, none call `getPlayersByTeam`). Those 4 routes actually call `getInjuryReport()` and `lib/data/news.ts`'s separate, unrelated `getLatestNews`/`getHighImpactNews` functions. **`getPlayersByTeam()` has zero real callers anywhere in the live app.** `getPlayerNews()` (the `lib/data/players.ts` one, not `lib/data/news.ts`'s same-named-but-unused sibling) does have 4 real callers, confirmed precisely: `app/api/trade-value/player-detail/route.ts`, `lib/ai-orchestration/sports-context-enricher.ts`, `lib/ai-tools-start-sit/runStartSitAnalysis.ts`, `lib/ai-tools-start-sit/runStartSitGlobalAnalysis.ts`. Both functions are now covered by the Phase 22 non-blocking guardrail — see [`FANTASY_OS_PLAYER_LOOKUP_SOAK_VALIDATION.md`](FANTASY_OS_PLAYER_LOOKUP_SOAK_VALIDATION.md).

## Routes reached via `runUnifiedOrchestration` → `enrichEnvelopeWithSportsData` → `searchPlayers`

The widest blast radius — shared infrastructure, not domain-specific. Live routes: `app/api/chat/chimmy`, `app/api/ai/chimmy`, `app/api/ai/run`, `app/api/ai/compare`, `app/api/ai/validation`, `app/api/ai/providers`, `app/api/ai/providers/health`, `app/api/simulation/matchup/insight`, and 6 `app/api/leagues/[leagueId]/*/explain` / `hall-of-fame/tell-story` routes. Triggered when `featureType` (normalized) matches `trade_analyzer`, `trade_evaluator`, `waiver_ai`, `draft_helper`, `matchup`, `simulation`, `rankings`, `chimmy_chat`, `fantasy_coach`, `trend_detection`, `player_comparison`, or raw `featureType` contains `waiver`/`draft`/`player-comparison`.

## Direct callers of `runSportsDataImporter()` (besides inside `getPlayer`/`searchPlayers`)

| Caller | Trigger | Auth |
|---|---|---|
| `app/api/cron/import-players/route.ts` | **Vercel Cron, every 6 hours** (`0 */6 * * *`), imports all `SUPPORTED_SPORTS` | Cron-secret gated — not publicly reachable |
| `lib/fantasy-data/importNflFantasyData.ts` | Stage in NFL admin import pipeline | Admin/bearer gated |
| `lib/fantasy-data/importNcaafFantasyData.ts` | Stage in NCAAF admin import pipeline | Admin/bearer gated |
| `lib/admin-dashboard/AdminSportsSyncService.ts` | Admin sync orchestrator | Admin/bearer gated |

## Domain usage confirmed absent (verified directly, not assumed)

- **Waiver** (`lib/waiver-*`, `lib/shared-services/waiver/`, `lib/decision-os/waiver/`): does **not** call `getPlayer`/`searchPlayers`/`runSportsDataImporter` — uses its own independent engines.
- **Draft** (`lib/draft-*`, `lib/live-draft-engine/`, `lib/shared-services/draft/`): does **not** call these functions.
- **Game Day / lineup** (`lib/shared-services/game-day/`): does **not** call these functions.
- **Commissioner** (`lib/shared-services/commissioner/`): does **not** call these functions.
- Most Dashboard AI Tools routes (matchup-prep, injury-impact, war-room, waiver-intelligence, start-sit, long-term-coaching, power-rankings) use their own dedicated modules, **not** this file — the one exception is Trending Players (`getPlayer`, confirmed above).

## Existing mitigation already in place (real, confirmed)

- `triggerBackgroundRefresh()` (`lib/data/shared.ts`) is genuinely fire-and-forget (returns `void`, deduped via a `pendingRefreshes` Map) — used for **stale-but-present** data, never blocks the response.
- A 6-hour Vercel Cron (`/api/cron/import-players`) keeps `SportsPlayerRecord` fresh under normal operation, matching `DATA_TTLS.players` exactly — meaning the synchronous, blocking path should mainly fire for **true misses** (a player/query with zero existing rows: brand-new players, typos, or unseeded sports), not routine staleness.
- **Phase 21**: the true-miss path in `getPlayer()`/`searchPlayers()` (rows 1-2 of the direct-caller table above) is now additionally covered by `requestPlayerImportRefresh()` (`lib/workers/sports-data-import-coordinator.ts`), gated by `PLAYER_LOOKUP_NON_BLOCKING_REFRESH` (default OFF). When enabled, the true-miss path no longer blocks the triggering request and gains single-flight + 5-minute cooldown protection. `runTradeConsoleAnalysis.ts` and `roster-context-loader.ts` (row 3 above) call `getPlayer` directly and inherit this same protection automatically — confirmed live this phase (`/api/trade-value/analyze` with an unresolved `playerId` asset: 170-189s → 9.8s). `getPlayersByTeam`/`getPlayerNews` (footnote row) remain unchanged/still-blocking, disclosed as out of Phase 21's explicit scope. Full detail: [`FANTASY_OS_PLAYER_RESOLUTION_LATENCY_MITIGATION.md`](FANTASY_OS_PLAYER_RESOLUTION_LATENCY_MITIGATION.md).
- **Phase 23 correction**: this doc's "footnote row" line above is now stale in one respect — `getPlayersByTeam`/`getPlayerNews` from `lib/data/players.ts` WERE covered in Phase 22 (not left unchanged as this line originally said before that phase). A separate, previously-undocumented real gap was found instead: `lib/data/news.ts`'s `getLatestNews()`/`getHighImpactNews()` (a different file, real live callers: `draft/assistant-context`, `sports-context-enricher.ts`, `chimmy-sport-data-digest.ts`) still synchronously `await runNewsImporter(...)` on a miss, entirely unguarded by any coordinator work through Phase 22. Full corrected caller graph for all four coordinator entry points: [`FANTASY_OS_IMPORT_COORDINATOR_RUNTIME_SCOPE.md`](FANTASY_OS_IMPORT_COORDINATOR_RUNTIME_SCOPE.md).
