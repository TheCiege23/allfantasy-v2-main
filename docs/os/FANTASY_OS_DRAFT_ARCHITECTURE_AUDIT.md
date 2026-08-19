# Draft OS — Fresh Architecture Audit (Phase 25)

**Status: audit only. No code changed. Prior (Phase 8) documentation was not trusted — everything below is re-verified fresh from source this phase, via direct grep/read, not inherited claims.**

## Two systems, correctly distinguished

1. **`lib/live-draft-engine/`** (39 files + 5 subdirectories: `auction/`, `commissioner/`, `expired-picks/`, `keeper/`, `slow-draft/`) — the real, live, production draft-room runtime: pick submission, timers, roster assignment, auction automation, NPC/AI-opponent autopick, keeper handling, commissioner tools. This is genuinely live and heavily used.
2. **`lib/shared-services/draft/`** (13 files: `index.ts`, `types.ts`, `DraftContextAssembler.ts`, `DraftRecommendationAdapter.ts`, `DraftShadowService.ts`, `DraftShadowResultStore.ts`, `README.md`, plus `backtest/` with `HistoricalDraftLoader.ts`, `DraftBacktestRunner.ts`, `DraftDivergenceAnalyzer.ts`, `types.ts`, `README.md`) — the Fantasy OS "Draft OS" shadow-mode module built in Phase 8. **Confirmed this phase: zero real callers anywhere in the app.** Its own `README.md` already discloses this ("Shadow mode only... nothing here is called by any live route") — the self-documentation is accurate.

## Every exported API of `lib/shared-services/draft/`

| Export | Source | What it does |
|---|---|---|
| `buildDraftDecisionContext()` | `DraftContextAssembler.ts:193-269` | Assembles a `DraftDecisionContext` from real `DraftSession`/`DraftPick`/`League`/`Roster` rows, real ADP snapshot, real roster template, real player pool. |
| `assembleEngineInputFromPicks()` | `DraftContextAssembler.ts:141-191` | Pure function: excludes drafted players, resolves identities, builds the real engine's `RecommendationInput`. |
| `playerKey()` | `DraftContextAssembler.ts:85-87` | Pure helper — `"name|position"` composite key. |
| `resolveLeagueScoringFlags()` | `DraftContextAssembler.ts:90-99` | Derives `isSF` from `starterSlots.QB >= 2`. |
| `runLegacyDraftGrader()` | `DraftRecommendationAdapter.ts:48-119` | Wraps `decideDraftPickWithScores` (the independent AI-opponent engine) as a comparison grader. |
| `evaluateDraftShadow()` / `evaluateDraftShadowFromContext()` | `DraftShadowService.ts:214-218` / `114-206` | Calls the real `computeDraftRecommendation` as primary value, compares against the legacy grader, appends to an in-memory result log. |
| `InMemoryDraftShadowResultStore` / `defaultDraftShadowResultStore` | `DraftShadowResultStore.ts:17-38` | In-process array log — not persisted, lost on restart. |
| `loadHistoricalDraftPickSamples()` | `backtest/HistoricalDraftLoader.ts:30+` | Loads real completed `DraftSession`/`DraftPick` rows, filtered to recognized platforms, round > 1 only. |
| `runDraftShadowBacktest()` | `backtest/DraftBacktestRunner.ts:107-137` | Reconstructs a genuine point-in-time context per sample, evaluates it. |
| `summarizeDraftDivergence()`, `summarizeDraftRealOutcomeAlignment()`, `summarizeDraftBacktest()`, `classifyDraftDivergence()` | `backtest/DraftDivergenceAnalyzer.ts` | Pure functions turning evaluation batches into parity/divergence statistics. |

## The real, live canonical draft engine

**`lib/draft-helper/RecommendationEngine.ts`** — `computeDraftRecommendation()` (line 373) / `computeDraftPlayerRankings()` (line 287). This is what `lib/shared-services/draft/` wraps for comparison, and what every real live draft route ultimately calls (directly or via one more layer).

**Formula, read directly from source** (`RecommendationEngine.ts:335-358`):
```
totalScore = needScore * 0.55 + adpEdge * 0.9 + formatBoost
adpEdge = clamp((overall - adp) * 1.4, -20, 25)
formatBoost: +14 if NFL && superflex && position===QB
             +4  if NFL && position===TE && roster template includes a TE slot
confidence = clamp(round(55 + totalScore * 0.6), 40, 92)
```
**No VORP/replacement-value term anywhere** — confirmed by grep across `RecommendationEngine.ts`, `lib/draft-helper/`, `lib/draft/`, `lib/ai/opponents/draft/`: zero matches for "vorp". `lib/vorp-engine.ts` exists but its only real consumers are `lib/hybrid-valuation.ts`, `lib/rankings-engine/adaptive-rankings.ts`, `lib/replay-framework/valuation/vorpResolver.ts`, `app/api/trade-evaluator/route.ts` — never the draft path.

**Zero randomness** — no `Math.random()`/`Date.now()`-influenced branching found anywhere in `RecommendationEngine.ts`. The engine is a genuinely pure function of its inputs.

## The real, independent comparison engine

**`lib/ai/opponents/draft/aiOpponentDraft.ts:70`** — `decideDraftPickWithScores()`. Requires a `BotProfile` (personality weights). Real caller: `lib/ai/opponents/liveDraftAiAutopick.ts:11,348` (NPC autopick on timer expiry) — a genuinely separate, independently-computed engine, used only for AI-opponent picks, never shown to human users as "the recommendation."

## Real live draft API routes (verified, not assumed)

Confirmed genuinely wired to the live draft-room UI (`components/app/draft-room/DraftRoomPageClient.tsx`):
- `app/api/draft/recommend/route.ts` → `runDraftAIAssist` → `lib/draft-ai-engine` → `computeDraftRecommendation`. Fetched from `DraftRoomPageClient.tsx:1779`, `hooks/useLeagueWarRoomCompanion.ts:417`.
- `app/api/ai/draft/recommend/route.ts` → `runDraftWarRoomRecommendation` (`lib/ai/aiDraftHelper.ts:282`) → `computeDraftRecommendation`. Fetched from `DraftRoomPageClient.tsx:3498`.
- `app/api/draft/live-brain/route.ts` → `runLiveDraftBrainDeterministic` (`lib/live-draft-brain`) → `computeDraftPlayerRankings`. Fetched from `DraftRoomPageClient.tsx:1766`.

`app/api/draft/**` (~70 routes) and `app/api/leagues/[leagueId]/draft/**` (~60 routes) exist in total; a full per-route live/dev classification of all ~180 was out of scope for the time available — this audit verified the 3 routes the recommendation-quality question actually depends on.

## Feature flags

No `SHARED_SERVICES_DRAFT`-style activation flag exists anywhere — the shared-services module isn't feature-flagged off, it is simply unreferenced code with no wiring at all. Real draft-adjacent flags found: `DRAFT_RI_MIN_LEAD_MS`, `DRAFT_RI_MIN_GAMES` (Rolling Insights analytics timing), `AF_DRAFT_POOL_PERF` (perf debug toggle), `AF_DRAFT_POOL_CACHE_TTL_SECONDS` (pool cache TTL, default 300s).

## Caching

- **`DraftPoolCache`** (real Prisma table, `prisma/schema.prisma:418-435`): `cacheKey`/`payload`/`syncedAt`/`expiresAt`, TTL-based (default 300s), **purely TTL invalidation — no proactive `delete` call found anywhere**. Warmed proactively by `app/api/cron/draft-pool-prewarm/route.ts` (every 30 min) for any league with an active/upcoming draft.
- **In-memory API cache** (`lib/api-performance/cache.ts`) as a fast-path layer in front of the DB cache.
- **ADP is NOT cached/versioned** — `readAllFantasyAdpForLeague()` reads live every call, no snapshot history — confirmed absence, matching the shared-services module's own disclosed limitation.

## Dependencies (exact import statements)

`lib/shared-services/draft/` does **not** import `lib/data/players.ts`, `SportsPlayerRecord`, or FantasyCalc. It goes through `getPlayerPoolForLeague()` (`lib/sport-teams/SportPlayerPoolResolver.ts`), which queries `prisma.sportsPlayer.findMany`/`prisma.playerIdentityMap.findMany` directly — real tables, one level removed from the module's own code.

## Dead code confirmed

`lib/draft/mockDraftAI.ts::getAIPick()` (lines 18-49) — zero callers anywhere in the repo, confirmed dead.
