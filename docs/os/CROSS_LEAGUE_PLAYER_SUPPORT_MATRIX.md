# Cross-League Player Intelligence Support Matrix

Date: 2026-07-13. Honest disclosure table. Every sub-case classified as
**production-wired**, **physically proven**, **fixture-proven**,
**source-verified**, **partial**, **unsupported**, **ambiguous**,
**unresolved**, **snapshot-only**, **stale-data blocked**, or
**deferred**.

## Identity

| Sub-case | Status |
|---|---|
| Verified canonical mapping (direct provider-id match) | **production-wired** — real `PlayerIdentityMap`/`SportsPlayer` direct-id columns, reused via `resolvePlayers()` |
| Sleeper direct-id resolution | **production-wired** — real column on both `PlayerIdentityMap` and `SportsPlayer` |
| ESPN / MFL / Fleaflicker direct-id resolution | **production-wired** — real `PlayerIdentityMap` columns |
| Yahoo / Fantrax direct-id resolution | **unsupported** — no direct-id column exists on `PlayerIdentityMap`; always falls back to name matching (see `CANONICAL_PLAYER_IDENTITY_CONTRACT.md`) |
| Duplicate-name disambiguation | **production-wired** — reuses `resolvePlayers()`'s real disambiguation scoring |
| Ambiguous identity | **production-wired** — a best-guess candidate is returned, flagged `ambiguous`, never silently merged |
| Unresolved identity | **production-wired** — kept as its own stable, provider-scoped item, never merged into another player's row |
| Defense/team-unit identity | **source-verified only** — not separately fixture-tested this phase |
| Traded-player team update | **source-verified only** — `professionalTeam` reflects whatever `resolvePlayers()`'s real `CanonicalPlayer.team` currently holds; not independently re-verified against a trade feed this phase |

## Roster / exposure

| Sub-case | Status |
|---|---|
| One league | **fixture-proven** |
| Multiple leagues, same provider | **fixture-proven** |
| Multiple leagues, multiple providers, same real player deduplicated | **physically proven** (Part 21, real `PlayerIdentityMap` fixture row) |
| Starter / bench / IR / taxi roster status | **production-wired** — real `getNormalizedLineupSections()` output, both the `lineup_sections`-normalized and Sleeper's flat-array shapes |
| Reserve / minor / inactive / unknown roster status | **partial** — `devy`→`minor` mapped; no distinct real signal for `reserve`/`inactive` beyond what the roster parser already exposes |
| Empty portfolio (no connected leagues) | **fixture-proven** — returns `{items: [], connectedLeagueCount: 0}`, never an error |
| Stale-league snapshot | **fixture-proven + physically proven** — real per-appearance `syncFreshness` reflects the real league's `lastSyncedAt`/`syncStatus` |
| Partial provider data | **source-verified only** |
| Player exposure (count/percentage) | **fixture-proven + physically proven** |
| Professional-team / position exposure | **source-verified only** — not a separate generator this phase; derivable from the real per-item `professionalTeam`/`position` fields but not pre-aggregated into a dedicated exposure report |
| Injury / bye-week / correlated-team concentration | **deferred** — not implemented this phase; the phase brief's Part 9 exposure sub-cases beyond player/league count are a real, disclosed scope cut |

## Injury

| Sub-case | Status |
|---|---|
| Healthy / questionable / doubtful / out / IR / suspended | **production-wired** — real `resolveInjuryContext()`, mapped through the real 4-category `InjuryAvailabilityCategory` (`available`/`uncertain`/`unavailable`/`unknown`) |
| `day_to_day` as a distinct status | **unsupported** — the real source data has no such category; `uncertain` covers `questionable`/`doubtful` together, `unavailable` covers `out`/`ir`/`suspended` together (see `CROSS_LEAGUE_PLAYER_FRESHNESS_POLICY.md`) |
| Injury description / expected return / practice status | **unsupported** — the real source (`SportsPlayer`) does not carry these fields at all (documented gap, `ADR_F2_3_INJURY_STATUS.md`) — always `null`, never fabricated |
| Stale injury data | **production-wired** — real per-player `injury.freshness` reflects the real `SportsPlayer` row's freshness, never silently presented as current |

## Schedule / bye week

| Sub-case | Status |
|---|---|
| NFL bye week | **production-wired** where a real, unambiguous schedule gap exists (`resolveScheduleContext`'s real "exactly one gap" derivation); `null` when ambiguous or data-absent, never guessed |
| NFL next opponent / kickoff | **production-wired** |
| NBA / MLB / NHL games-remaining, schedule density, back-to-backs | **unsupported** — no real equivalent engine exists yet (confirmed via Part 1 inventory) |
| Soccer next fixture, congestion, blank/double gameweek | **unsupported** — no general-league soccer schedule data exists (only a World-Cup-specific subsystem) |
| College football / college basketball schedule | **unsupported** this phase's cross-league service, though some real NCAAF schedule data exists elsewhere in the codebase (not wired here) |

## League-specific recommendations

| Sub-case | Status |
|---|---|
| Different real actions for the same player in different leagues | **production-wired + fixture-proven** — reuses `assembleUserOsRecommendations()` per league, filtered by `playerIds` |
| No recommendation fabricated when User OS has none for that league | **production-wired** — `recommendation: null`, never a filler action |
| Execution-capability truthfulness (native/copy/recommendation-only) | **partial** — real for `native_execute` (AllFantasy) and when a real recommendation supplies its own `executionCapability`; otherwise defaults to `recommendation_only`, not independently re-verified against the full provider capability matrix (`providerCapabilities.ts`) this phase |

## Headshots / imagery

| Sub-case | Status |
|---|---|
| Real headshot when the roster's own provider data carries an image | **production-wired** |
| Real Sleeper-derived headshot from a numeric Sleeper id | **production-wired** |
| Missing image → letter/initial fallback | **production-wired** — never blocks the portfolio |
| Governed 4-tier `canonicalImage.ts` precedence policy | **deferred** — evaluated, not wired this phase (see `CROSS_LEAGUE_PLAYER_ARCHITECTURE.md`) |
| Team logos | **unsupported** — not wired this phase |

## Multi-sport

| Sport | Status |
|---|---|
| NFL | **partial** — roster/exposure/identity/injury/schedule/recommendations all real for this sport |
| NBA, MLB, NHL | **partial** — roster/exposure/identity/injury real (sport-neutral primitives); schedule/bye **unsupported** |
| Soccer, college football, college basketball | **partial** — roster/exposure/identity real where real roster data exists; injury/schedule **unsupported** |

## Chimmy seam

`getChimmyCrossLeaguePlayerSummary()` / `getChimmyPlayerLookup()` —
**fixture-proven + physically proven** access control (cross-user
rejection returns `null`, identical to a nonexistent player); **not wired
into `lib/chimmy-context/*`** this phase, per the explicit instruction not
to rewrite Chimmy yet.
