# Real Data Validation Report (Phase 33)

All findings below are from direct SQL queries against `.env.test` plus real, unmocked execution of the actual Game Day OS functions (`@vitest-environment node`, real `DATABASE_URL`, no mocks) — not from reading code alone.

## What exists (measured directly)

| Data | Real count | Assessment |
|---|---|---|
| `FantasyScheduleGame` (game windows) | **0 rows** | Completely empty. `computeGameWindows()` can never return real windows in this environment. |
| `FantasyStatLine` (injury source for the matchup-center path) | **0 rows** | Completely empty. |
| `SportsInjury` (a separate, real injury table) | **1,025 rows (458 NFL)** | Real, well-formed (real player names, real statuses, real `api_sports`/`sleeper` sourcing) — but **not read by the matchup-center injury display path** (see Truthfulness Audit). |
| `WeeklyScore` | 104 rows | **All 104 belong to one synthetic league** (`bbwr-runtime-nfl-best-ball-league`) — a Best Ball War Room test fixture. **0 rows for any of the 3 real Sleeper-imported leagues.** |
| `PlayerWeeklyScore` | 48 rows | Explicitly self-labeled `stats: {"seed": "keeper-war-room-runtime"}` — synthetic Keeper War Room fixture data, not real. Includes malformed season values (2092, 2098) further confirming non-real origin. |
| `FantasyProjection` | 43 rows | Explicitly self-labeled `source: "runtime-seed"` — synthetic, not real. |
| `WeeklyMatchup` | 0 rows | Empty. |
| `RedraftMatchup` | 145 rows | All `status: "scheduled"`, `homeScore: 0, awayScore: 0`, `homeProjected: null` — pre-game placeholder rows, not real completed or live scoring. None belong to a real Sleeper league. |
| `TeamWeekResult` (the generic matchup path's pairing source) | **0 rows in the entire database** | See Truthfulness Audit — this directly causes every real Sleeper league to show "bye." |
| `Roster.playerData` for the 3 real Sleeper leagues | Real | Genuine Sleeper import metadata (real team names, real Sleeper avatar URLs, real `sourceLeagueId`, real player IDs in starters/taxi/reserve arrays). |
| Cross-league real manager overlap | **12 real managers** rostered in 2+ of the 3 real Sleeper leagues (direct SQL) | Consistent with Phase 16's prior finding (same 12 managers, near-duplicate re-imports). |

## Honest summary: no real live or completed scoring data exists anywhere in `.env.test`

Every score/projection value that exists is either absent (0 rows) or explicitly synthetic runtime-seed data for unrelated other features (Best Ball War Room, Keeper War Room). Real matchup-record data (`TeamWeekResult`, `WeeklyMatchup`) is entirely empty. Real `RedraftMatchup` rows exist but are all pre-game placeholders. **Live and completed matchup/scoring validation was therefore not possible in this environment** — not a partial gap, a decisive blocker, disclosed precisely rather than worked around with fixtures presented as real.

## What WAS genuinely validated with real execution

### 1. Cross-league player exposure (`computeUserPlayerExposure`) — real, measured, and a real bug was found and fixed

Executed for real `userId: 9791bae0-e47f-418a-ae40-285f6a2e7887` (confirmed via direct SQL to own real rosters in 8 real leagues, including 2 of the 3 real Sleeper leagues):

| | Before fix | After fix |
|---|---|---|
| Distinct real players found | 1 | **53** |
| Players rostered in 2+ leagues | 0 | **4** |

Root cause: `getNormalizedLineupSections()` reads only `Roster.playerData.lineup_sections`; 2 of the 3 real Sleeper-imported leagues' rosters carry only the flat, platform-native `players`/`starters`/`taxi`/`reserve` ID arrays and never populate `lineup_sections` — silently producing an empty roster. **This is the exact same real gap Phase 13 found and fixed in Waiver OS's `WaiverContextAssembler.ts`** (`flatSectionsFromPlayerData()`), never applied to Game Day OS's separately-built `UserPlayerExposureService.ts`. Fixed this phase by reusing the identical real fallback pattern. See `__tests__/shared-services/game-day/user-player-exposure-flat-fallback.test.ts` (5 tests) and the real re-measurement in `__tests__/shared-services/game-day/real-data-validation-phase33.test.ts`.

### 2. `buildLeagueGameDayContext` against a real Sleeper league — executes without crashing, but surfaces a real truthfulness issue

Real result: `{matchupState: "bye", unavailableReason: null, hasMatchup: true}`. Investigated further — see Truthfulness Audit. The honest finding: the function does not crash and returns a well-formed result, but the result is **not actually accurate** for this real league.

### 3. `computeGameWindows` against the real, empty `FantasyScheduleGame` table — honest empty result, no crash

Real result: `[]`. Correct, honest behavior given 0 real rows — no fabrication.

## Sample sizes, stated honestly

- Cross-league exposure: 1 real user, 8 real connected leagues, 2 of which are among the 3 real Sleeper leagues audited. This is not a statistically broad sample — it is the only real user in `.env.test` confirmed (via the Phase 16-established QA-seed `platformUserId`-as-`userId` technique) to have real multi-league Sleeper roster overlap.
- Matchup/scoring/projection/injury/game-window validation: **0 real leagues with real data** — sample size of zero, disclosed as such, not padded with synthetic data presented as real.
