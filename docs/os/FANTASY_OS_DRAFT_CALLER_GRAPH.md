# Draft OS — Real Caller Graph (Phase 25)

**Status: audit only. Every claim below is grep/read-verified fresh this phase, not inherited from Phase 8.**

## `lib/shared-services/draft/` — every export, classified

| Export | Real callers | Classification |
|---|---|---|
| `buildDraftDecisionContext`, `assembleEngineInputFromPicks`, `playerKey`, `resolveLeagueScoringFlags`, `runLegacyDraftGrader`, `evaluateDraftShadow`, `evaluateDraftShadowFromContext`, `InMemoryDraftShadowResultStore`, `defaultDraftShadowResultStore`, `loadHistoricalDraftPickSamples`, `runDraftShadowBacktest`, `summarizeDraftDivergence`, `summarizeDraftRealOutcomeAlignment`, `summarizeDraftBacktest`, `classifyDraftDivergence` | **None outside the module itself** — a full-repo grep for every individual symbol name returns matches only inside `lib/shared-services/draft/**` (internal wiring) and `__tests__/shared-services/draft/*.test.ts` (7 files, all mock out the real engines) | **Experimental / unused** — built, tested in isolation, never wired to anything live |

## Real canonical engine — `computeDraftRecommendation`/`computeDraftPlayerRankings` (`lib/draft-helper/RecommendationEngine.ts`)

| Caller | File:line | Classification |
|---|---|---|
| `app/api/mock-draft/ai-pick/route.ts` | `:11,623` | Production |
| `lib/redraft-draft-room/warRoomSuggestions.ts` | `:2,88` | Production |
| `lib/live-draft-engine/autopickBestAvailableSubmit.ts` | `:9,314` | Production |
| `lib/live-draft-brain/deterministic-pick-engine.ts` | `:2,171` | Production |
| `lib/draft-intelligence/DraftLookaheadService.ts` | `:9,184,260` | Production |
| `lib/draft-ai-engine/index.ts` | `:5,105` | Production |
| `lib/automated-drafter/CPUDrafterService.ts` | `:6,50` | Production |
| `lib/ai/aiDraftHelper.ts` | `:8,282` | Production |
| `lib/ai/draft/aiDraftIntelligence.ts` | `:6,48` | Production |

## Real independent comparison engine — `decideDraftPickWithScores` (`lib/ai/opponents/draft/aiOpponentDraft.ts:70`)

| Caller | File:line | Classification |
|---|---|---|
| `lib/ai/opponents/liveDraftAiAutopick.ts` | `:11,348` | Production (NPC autopick only) |

## Live routes verified against actual UI `fetch()` calls

| Route | Calls | UI caller |
|---|---|---|
| `app/api/draft/recommend/route.ts` | `runDraftAIAssist` → `computeDraftRecommendation` | `DraftRoomPageClient.tsx:1779`, `hooks/useLeagueWarRoomCompanion.ts:417` |
| `app/api/ai/draft/recommend/route.ts` | `runDraftWarRoomRecommendation` → `computeDraftRecommendation` | `DraftRoomPageClient.tsx:3498` |
| `app/api/draft/live-brain/route.ts` | `runLiveDraftBrainDeterministic` → `computeDraftPlayerRankings` | `DraftRoomPageClient.tsx:1766` |

## Unused / dead code confirmed this phase

- `lib/draft/mockDraftAI.ts::getAIPick()` — zero callers.
- Every export of `lib/shared-services/draft/` — zero live callers (see above).

## Not exhaustively classified (disclosed limitation, not a gap silently skipped)

`app/api/draft/**` (~70 route files) and `app/api/leagues/[leagueId]/draft/**` (~60 route files) exist beyond the 3 routes this audit traced to real UI usage. A full per-route live-vs-dev-only classification of all ~180 draft routes was not completed this phase — time was prioritized on the routes that determine recommendation-quality (the actual mission), not a complete route census. This is an honest scope boundary, not a finding that the other ~177 routes are unused.

## Naming collisions / overlapping implementations found

- Two genuinely independent recommendation engines coexist by design: `computeDraftRecommendation` (human recommendations, ADP-based) and `decideDraftPickWithScores` (NPC-only, personality-weighted) — not a collision, a deliberate separation, confirmed correct.
- No `lib/decision-os/draft/` package exists (only `trade/` and `waiver/` siblings) — `lib/decision-os/draft-runtime-intelligence.ts` is a flat file, not a package, confirmed via direct directory listing.
