# Waiver Service (Shadow Mode) — Phase 7

Waiver OS foundation, Fantasy OS Migration Plan. Mirrors the architecture of [`lib/shared-services/trade/`](../trade/README.md) (Phase 5). **Shadow mode only** — nothing here is called by any live route, no UI changes, no API changes, no recommendation logic is authoritative.

## What was audited first

A full inventory of every real waiver-related implementation was built before any code was written (mirroring Trade OS Phase 5's discipline). Full findings:

### Recommendation/scoring engines
- **`lib/waiver-engine/waiver-scoring.ts`** (`scoreWaiverCandidates`) + **`lib/waiver-ai-engine/` (`runWaiverAIService` → `suggestWaiverPickups`)** — the real, live, canonical deterministic engine. Called by `app/api/waiver-ai/engine/route.ts` and already wrapped (not recomputed) by Decision OS's own `lib/decision-os/waiver/decision.ts`. **This is what this module reuses as its own primary recommendation value** — same role `computeTradeDrivers` played for Trade OS.
- **`lib/ai/waivers/waiverRecommendationService.ts`** (`generateWaiverRecommendations`) — a genuinely independent, cruder, live engine (own FAAB percentage-slicing, own prisma reads), called by `app/api/ai/waivers/recommend/route.ts`. **This is the one real comparison-only "legacy grader" this module logs divergence against** — same role T2 played for Trade OS.
- Format-specific "War Room" engines (redraft/dynasty/keeper/guillotine/best-ball waiver engines) — a legitimate separate family of per-format-tuned engines, each live via its own route. Not duplicates of the above; out of scope for this phase.
- **Orphaned/dead code found, deliberately left untouched**: `lib/waiver-engine/waiver-faab-engine.ts`'s exported `computeFaabBid`/`computeFaabStrategy` (re-exported by the barrel but zero real callers anywhere in the repo — `waiver-scoring.ts` has its own private, differently-shaped `computeFaabBid` at line 646 that the live chain actually uses) and `lib/trade-engine/waiverEngine.ts` (no callers found at all).

### Decision OS already has a waiver slice
`lib/decision-os/waiver/` (Slice 2) already exists and is more built-out than the trade slice was pre-Phase-5: `decision.ts` (`decideWaiverClaim`), `dco.ts`, `rules.ts`, `world.ts`, `deps.ts`, `loader.ts`, `outcome.ts`, `waiverCardAdapter.ts`, `parity.ts`, `shadow.ts`. It **wraps** `runWaiverAIService` (injected via `deps.recommend`), gates the top candidate through `evaluateWaiverRules`, and is already `automation_capable: false` (shadow-only by its own design). This module does not duplicate or replace that slice — it is a lower-level, reusable shared service that a future Decision OS wiring step could consume instead of calling `runWaiverAIService` directly, but that migration is out of scope here.

### Claim processing (not recommendation)
`lib/waiver-wire/process-engine.ts`'s `processWaiverClaimsForLeague` is confirmed to be a pure settlement engine — orders already-submitted `WaiverClaim` rows (rolling/reverse-standings/FCFS tiebreaks via `orderClaimsForProcessing`), validates, executes the DB transaction, and already calls the Phase 3 Knowledge Graph hook (`recordWaiverClaimSignal`). It does no ranking/recommendation of free agents and is untouched by this phase.

### Provider neutrality — a real, verified difference from Trade OS
Trade OS's context assembler (Phase 4) needed a live external re-fetch (`runImportedLeagueNormalizationPipeline`) because trade evaluation needed the CURRENT state of a Sleeper/ESPN/etc league. Waiver evaluation does not — `Roster.playerData` and `League` are already the canonical, provider-neutral model once a league exists (imported or native), verified via `lib/roster/LineupTemplateValidation.ts`'s `getNormalizedLineupSections()` (the same `starters/bench/ir/taxi/devy` shape every provider's import bootstraps into) and `lib/sport-teams/SportPlayerPoolResolver.ts`'s `getPlayerPoolForLeague()` (the same sport-scoped free-agent pool resolver the live `app/api/waiver-wire/leagues/[leagueId]/players/route.ts` already uses). **This means natively-created leagues, not just imported ones, are backtestable here** — a real capability improvement over Trade OS's Phase 6 backtest, which could only replay trades on provider-imported leagues.

### Waiver history / learning capture — NOT durable, unlike Trade Learning
No `WaiverOfferEvent`/`WaiverOutcomeEvent` models or `waiverLearningCapture.ts` exist. The Knowledge Graph's `WaiverSignalHook.ts` (`recordWaiverClaimSignal`) only writes to the in-memory `SignalStore` (Phase 3) — no durable, no predicted-probability-at-decision-time capture exists for waivers the way `TradeOfferEvent.acceptProb` exists for trades. Real, durable historical data DOES exist via `WaiverClaim` joined to `WaiverResult` (win/loss + FAAB delta) and `WaiverTransaction` — see `backtest/README.md` for exactly how this module uses that data honestly (comparing freshly-recomputed shadow/legacy outputs against real outcomes, not a stored prediction).

## Modules

- **`WaiverContextAssembler.ts`** — assembles a provider-neutral `WaiverAIEngineInput` from real Prisma reads + the sport-scoped free-agent pool + batch FantasyCalc valuation.
- **`WaiverRecommendationAdapter.ts`** — wraps `generateWaiverRecommendations` (the one real comparison-only engine) for divergence.
- **`WaiverShadowService.ts`** — orchestrates the assembler + `runWaiverAIService` (primary, reused) + the adapter (comparison, caught) + Phase 3 Knowledge Graph manager tendency, producing one canonical `WaiverEvaluation`.
- **`WaiverShadowResultStore.ts`** — in-memory shadow log, same disclosed non-durable pattern as Trade OS's.
- **`backtest/`** — see [`backtest/README.md`](backtest/README.md).

## Known limitations

- `WaiverRecommendationAdapter`'s legacy call uses `Roster.platformUserId` as `generateWaiverRecommendations`'s `userId` parameter — that function's own internal prisma reads were not audited in depth, so a provider-dependent mismatch is possible. Comparison-only impact, never authoritative.
- `isTEP` (tight-end-premium) is not detected and defaults to `false` — the same documented, bounded simplification `tradeLearningCapture.ts` already uses.
- Player valuation falls back to a flat value (200) when no FantasyCalc name match is found — same convention as Trade OS's live capture code.
- `rosterPositions`/team-needs (`needs`/`surplus`) are empty when `League.starters` isn't a resolvable array — a real, reported data gap, not a guess.

## What is NOT done in this phase

No consumer (UI, API, Decision OS, Commissioner OS, Legacy OS, Game Day, Notifications) is migrated. No schema/migration added. No live behavior changed.
