# Shared Player Pool Resolver — Consumer Audit (Phase 27)

**Status: fresh, grep-verified this phase. `getPlayerPoolForSport()`/`getPlayerPoolForLeague()` in `lib/sport-teams/SportPlayerPoolResolver.ts`.**

## Every real caller, classified

| Caller | File:line | Domain | Real limit used |
|---|---|---|---|
| `app/api/leagues/[leagueId]/draft/controls/route.ts` | `:141` | Draft — live route | (see call site) |
| `app/api/waiver-wire/leagues/[leagueId]/players/route.ts` | `:57` | Waiver — live route | (see call site) |
| `lib/ai-tools-waiver/waiver-intelligence.ts` | `:678` | Waiver — AI tools | (see call site) |
| `lib/draft-intelligence/DraftLookaheadService.ts` | `:150` | Draft | 500 |
| `lib/draft-room/getResolvedDraftPoolForLeague.ts` | `:823` | Draft — core, perf-instrumented (`perfStart('5. getPlayerPoolForLeague...')`) | variable (`poolFetchLimit`) |
| `lib/live-draft-engine/autopickBestAvailableSubmit.ts` | `:117` | Draft — live autopick | (see call site) |
| `lib/live-draft-engine/auction/AuctionAutomationService.ts` | `:89` | Draft — auction automation | 500 |
| `lib/mock-draft/sport-player-pool.ts` | `:24-25` | Draft — mock drafts, both `getPlayerPoolForLeague` and `getPlayerPoolForSport` | variable |
| `lib/orphan-ai-manager/OrphanAIManagerService.ts` | `:212` | Roster/AI-manager tooling | 500 |
| `lib/player-data/getPlayerDataForSurface.ts` | `:290` | Shared — forwards to Waiver per its own docstring ("Waivers: forwarded to `getPlayerPoolForLeague`") | variable |
| `lib/sport-teams/LeaguePlayerPoolBootstrapService.ts` | `:32` | Shared bootstrap | 2000 (default) |
| `lib/sport-teams/UniversalPlayerService.ts` | `:26` | Generic wrapper (`getPlayerPoolForSport` only) | passthrough |
| `lib/workers/draft-worker.ts` | `:202` | Draft — background worker | 500 |
| `lib/shared-services/waiver/WaiverContextAssembler.ts` | `:275` | Waiver OS shared-service (Phase 7) | `maxFreeAgents` (real call, confirmed via docstring at `:12`: "the same function the live [route] already reuses") |
| `lib/shared-services/draft/backtest/DraftBacktestRunner.ts` | (via `DraftContextAssembler.ts`) | Draft OS shared-service (Phase 8) | 800 |

## Classification summary

- **Draft consumers**: 7 real call sites (controls route, `DraftLookaheadService`, `getResolvedDraftPoolForLeague`, `autopickBestAvailableSubmit`, `AuctionAutomationService`, `mock-draft`, `draft-worker`), plus the shared-services Draft backtest module (Phase 8).
- **Waiver consumers**: 3 real call sites (waiver-wire route, `waiver-intelligence`, `WaiverContextAssembler`).
- **Shared/other consumers**: 4 (`getPlayerDataForSurface`, `LeaguePlayerPoolBootstrapService`, `UniversalPlayerService`, `OrphanAIManagerService`).
- **Unused exports**: none found — every exported function of this module (`getPlayerPoolForSport`, `getPlayerPoolForLeague`, `isPlayerInSportPool`) has real callers.
- **Experimental callers**: none — every real call site traced to production code, not test-only scaffolding.

## Real limits observed across callers

Range from 500 to 2,000, with the Draft-room core path and shared-services modules typically requesting 500–800, and Waiver's `WaiverContextAssembler` using a dynamic `maxFreeAgents` value. This range directly informed this phase's fix design and its documented residual limitation (see `FANTASY_OS_DRAFT_WAIVER_IMPACT_REPORT.md`).
