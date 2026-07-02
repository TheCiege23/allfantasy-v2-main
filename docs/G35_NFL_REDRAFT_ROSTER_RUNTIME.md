# G35 NFL Redraft Roster Runtime

## Scope

G35 completes the NFL redraft roster runtime layer needed after a draft has been completed. It does not add Decision OS features, recommendations, intelligence consumers, or fabricated player data. The runtime emits canonical events and exposes deterministic roster state so external OS work can consume it later.

## Architecture

- `lib/roster-runtime/canonicalRosterRuntime.ts` is the pure deterministic roster runtime.
- `lib/roster-runtime/resolveNflRedraftRosterRuntime.ts` resolves DB rosters through G33 canonical league rules.
- `app/api/leagues/[leagueId]/roster/runtime/route.ts` exposes a scoped audit/read endpoint:
  - commissioners and co-commissioners can inspect all NFL redraft rosters
  - managers can inspect only their own roster
  - non NFL-redraft leagues are rejected
- Existing roster persistence remains in `lib/roster-lineup-engine/lineupService.ts`.
- Existing draft completion materialization remains in `lib/live-draft-engine/RosterAssignmentService.ts` and `lib/league/roster/draft-to-roster-sync.ts`.

## Runtime Flow

1. G33 canonical rules define sport, format, roster size, starters, IR slots, and reserve-eligible statuses.
2. Completed draft picks are materialized into `Roster.playerData.draftPicks` and, when no manual lineup exists, structured `lineup_sections`.
3. The G35 runtime derives starters, bench, IR, empty starter slots, capacity, validation issues, and player locks.
4. The existing roster save path validates, persists `Roster.playerData`, syncs normalized lineup assignment rows, records move history, updates lock cache, and emits a canonical lineup event.

## Canonical Rule Usage

The runtime derives starter slots and capacity from `CanonicalLeagueRules.roster`.

Supported slot behavior:

- starters
- bench
- IR
- FLEX: RB, WR, TE
- Superflex and OP: QB, RB, WR, TE
- K
- DEF, including DST and D/ST normalization
- empty required starter slots
- active roster and IR limits

## Validation

The runtime blocks:

- active roster over limit
- starter over limit
- bench over limit
- IR over limit
- duplicate players
- empty required starters
- starter position ineligible
- invalid active roster positions
- healthy or unsupported IR players
- inactive, out, suspended, IR, PUP, or reserve starters
- locked player movement by non-commissioners

Bye-week starters are warnings, not blockers.

## Player Movement

`planCanonicalRosterMove` supports deterministic move planning for:

- starter to bench
- bench to starter
- reorder within a section
- move to IR
- remove from IR
- commissioner override of locked-player movement

The planner returns either blocking issues or the next canonical sections plus canonical runtime events. It does not persist directly; persistence remains in the existing validated save path.

## Player Locking

The pure runtime marks a player locked when:

- the player has `locked` or `isLocked` on persisted state
- `gameStartIso`, `gameTime`, or `game_time` is at or before runtime `now`
- a lock override id is supplied by the caller

The existing `lineupLockService` remains the DB-backed lock authority for route persistence and cache rows.

## Runtime Events

G35 extends canonical event normalization with roster and lineup events:

- `lineup.submitted`
- `lineup.updated`
- `lineup.starter.changed`
- `roster.updated`
- `roster.player.added`
- `roster.player.dropped`
- `roster.player.started`
- `roster.player.benched`
- `roster.player.moved_to_ir`
- `roster.player.removed_from_ir`
- `roster.player.locked`
- `roster.player.unlocked`
- `commissioner.override`

The existing `persistRosterLineupWithEngine` path now publishes low-noise canonical fan-out events after validated persistence. No downstream intelligence consumer is added.

## Commissioner Functionality

Commissioner-facing support remains in existing tools:

- invalid roster audit through `app/api/commissioner/leagues/[leagueId]/lineup/route.ts`
- force correction through existing commissioner lineup controls
- commissioner override route through `app/api/leagues/[leagueId]/rosters/[rosterId]/commissioner-override/route.ts`
- G35 runtime audit endpoint for all-team canonical state and coverage

## Future Decision OS Integration Points

Future OS work can consume:

- canonical roster runtime state
- canonical roster validation issues
- canonical runtime events
- lock state and lock reasons
- coverage summaries from `resolveNflRedraftRosterRuntime`

Those surfaces are read-only inputs for future systems. G35 does not derive recommendations or manager/commissioner intelligence.

## Verification

Passed:

- `cmd /c npx vitest run __tests__/g35-nfl-redraft-roster-runtime.test.ts --reporter=verbose`
- `cmd /c npx vitest run __tests__/g33-canonical-league-runtime.test.ts __tests__/g34-draft-runtime.test.ts __tests__/g35-nfl-redraft-roster-runtime.test.ts --reporter=verbose`
- `cmd /c npx vitest run __tests__/league/draft-to-roster-sync.test.ts __tests__/roster-lineup-engine-validation.test.ts __tests__/lineup-template-validation.test.ts --reporter=verbose`
- `cmd /c npx vitest run __tests__/draft/draft-completion-chain.test.ts __tests__/draft/finalized-roster-dashboard-sync.test.ts --reporter=verbose`
- `cmd /c npx eslint app/e2e/roster/page.tsx app/e2e/commissioner/page.tsx app/api/leagues/[leagueId]/roster/runtime/route.ts lib/league-runtime/leagueRuntimeEvents.ts lib/roster-runtime/canonicalRosterRuntime.ts lib/roster-runtime/resolveNflRedraftRosterRuntime.ts lib/roster-runtime/index.ts lib/roster-lineup-engine/lineupService.ts __tests__/g35-nfl-redraft-roster-runtime.test.ts`
- `cmd /c npx playwright test e2e/roster-board-click-audit.spec.ts e2e/commissioner-lineup-click-audit.spec.ts --project=chromium --reporter=line`

Notes:

- The targeted `tsc` attempt with a temporary G35 config exhausted Node heap before diagnostics. ESLint and Vitest transforms were used as the targeted parse/static checks instead.
- The first Playwright attempt found missing `/e2e/roster` and `/e2e/commissioner` harness pages. G35 restores those thin harness pages and the rerun passes.
- The passing Playwright run logged existing dev-server noise after completion: aborted requests and Meta CAPI errors for placeholder Meta configuration.

## Remaining Gaps

- No readiness increase was made.
- Full authenticated browser proof for the entire draft completion to roster edit to live kickoff lock workflow was not proven in this pass.
- Browser proof is Chromium harness coverage for roster interactions and commissioner lineup correction, not full production mobile coverage.
- The runtime endpoint was statically parsed and covered indirectly through imports, but no authenticated HTTP integration test was added for that endpoint in G35.
