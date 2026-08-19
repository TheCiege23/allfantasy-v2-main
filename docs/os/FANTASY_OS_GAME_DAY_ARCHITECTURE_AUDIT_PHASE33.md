# Game Day OS Architecture Audit (Phase 33)

Fresh audit — prior Phase 9 documentation was not trusted; every claim below was independently re-verified this phase by reading the actual files and finding actual real callers.

## `lib/shared-services/game-day/` — per-file summary

| File | Real inputs | Real Prisma models touched | Disclosed gaps |
|---|---|---|---|
| `types.ts` | — (pure types) | — | Header: "SHADOW MODE ONLY — nothing here is called by any live route" |
| `index.ts` | — (barrel) | — | — |
| `GameDayContextAssembler.ts` | `leagueId`, `viewerUserId` | `League` (select only) | Reuses real `buildMatchupCenterPayload`/`resolveCurrentWeek` directly, confirmed real |
| `GameDayDivergenceAnalyzer.ts` | legacy vs. new attention items | — (pure) | 7 of 10 declared divergence categories never produced (confirmed true by reading the function body) |
| `GameDaySnapshotService.ts` | `userId` | `UserProfile`, `Roster` | Top-level orchestrator; persistence errors swallowed non-fatally |
| `GameDaySnapshotStore.ts` | — | none (in-memory array) | Explicitly not durable, lost on process restart |
| `GameWindowService.ts` | `sport`, `season` (string), `week` | `FantasyScheduleGame` | None disclosed; real bug found this phase — see Real Data Audit |
| `LineupAttentionService.ts` | `userId`, league contexts | `FantasyScheduleGame` (postponement check) | `bench_out_projecting_starter`/`healthy_player_on_ir` declared but never computed — `MatchupCenterPayload` only exposes starters |
| `MatchupStateNormalizer.ts` | matchup payload | — (pure) | Deliberately trusts upstream provider status, doesn't infer from clock alone |
| `UserPlayerExposureService.ts` | `userId` | `UserProfile`, `Roster` | **Real bug found and fixed this phase** — see Real Data Audit / Truthfulness Audit |
| `README.md` | — | — | Explicitly: "Shadow Mode," lists every real surface NOT migrated (dashboard, matchup page, Start/Sit UI, notifications, Chimmy, Commissioner OS, mobile) |

## Real reused engines (confirmed, not assumed)

- **`buildMatchupCenterPayload`** — `server/services/matchupCenterService.ts:108`. Real, live, 429 lines. Real callers: `app/api/leagues/[leagueId]/matchup-center/route.ts`, `app/api/leagues/[leagueId]/ai/matchup/route.ts`, and real UI (`components/matchup-center/MatchupTabContainer.tsx` and siblings).
- **`computeLineupActionsForUser`** — `lib/lineup-actions/computeLineupActionsForUser.ts:89`. Real, live, 307 lines. Real callers: `app/api/today/lineup-actions/route.ts` (+ `[leagueId]` variant), `app/api/lineup-check/route.ts`, `lib/today-actions-engine/`, `lib/war-room-command-center/`, and Decision OS's flag-gated lineup shadow/live path (`lib/decision-os/lineup/shadow.ts`).
- **Live scoring**: `server/services/canonicalPlayerScores.ts`'s `loadCanonicalPlayerScores()` — reads real `WeeklyScore` (materialized) and `PlayerWeeklyScore` (raw), falling back to `calculateScoreFromSportConfig` (`lib/redraft/scoringEngine.ts`).
- **Projections**: no dedicated service call — `matchupCenterService.ts` reads a projection value embedded in the per-player `statLine` JSON, with a hardcoded position-based fallback when absent. The real `FantasyProjection` table exists but is never queried directly by the matchup path.
- **Injury data**: same `statLine` JSON mechanism, ultimately backed by `FantasyStatLine` — a **separate, real, populated `SportsInjury` table (1,025 rows, 458 NFL) exists but is not read by this pathway** (see Truthfulness Audit).

## Full caller graph of `lib/shared-services/game-day/` itself

**Zero real callers.** No file under `app/`, `components/`, or `scripts/` imports anything from this module. The only importer is `lib/shared-services/commissioner/CommissionerContextAssembler.ts` (Phase 10's Commissioner OS shadow module) — which **itself also has zero real callers**, confirmed by the same search. This is shadow-module calling shadow-module; neither reaches a real HTTP route, cron job, or rendered UI component today. Test-only callers: 9 files under `__tests__/shared-services/game-day/` (8 pre-existing + 1 new this phase) plus `__tests__/shared-services/commissioner/commissioner-context-assembler.test.ts`.

This matches the module's own disclosure exactly (`types.ts`: "SHADOW MODE ONLY") — independently confirmed, not taken on faith.

## Net assessment

The underlying reused engines (`buildMatchupCenterPayload`, `computeLineupActionsForUser`) are real and already serve real production traffic. Game Day OS's own code calls those same real engines and real Prisma tables directly when invoked — so it is *technically capable* of running against real data today. But it has never been invoked in production; validation this phase (see Real Data Validation Report) is the first time any of this module's functions have been executed against the real `.env.test` database rather than mocks.
