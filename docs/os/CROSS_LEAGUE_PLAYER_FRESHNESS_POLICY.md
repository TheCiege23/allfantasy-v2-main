# Cross-League Player Freshness Policy

Date: 2026-07-13. Part 16 — every field that carries a freshness claim,
and why a single portfolio item can honestly show mixed freshness across
its own sub-fields.

## Six independent freshness surfaces, never collapsed into one

| Field | Real source | Freshness derivation |
|---|---|---|
| Roster ownership / lineup state (`leagueAppearances[].rosterStatus`) | `Roster.playerData`, read live on every request | Not separately timestamped — reflects whatever is in the DB right now |
| Per-league sync freshness (`leagueAppearances[].syncFreshness`) | `League.lastSyncedAt`/`syncStatus`, via the same real `deriveSyncFreshness()` every other League Hub surface uses | `fresh` / `stale` / `syncing` / `failed` / `never_synced` / `not_applicable` |
| Injury (`injury.freshness`) | `SportsPlayer` cache row's real `expiresAt`/`updatedAt`, via `resolveInjuryContext()`'s real `InjuryContext.freshness` | `stale` when `expiresAt` has passed; `unknown` when no freshness data exists at all — never assumed fresh by default |
| Schedule/bye (`schedule.freshness`) | `FantasyScheduleGame` cache row's real freshness, via `resolveScheduleContext()`'s real `TeamScheduleContext.freshness` | Same `stale`/`fresh`/`unknown` pattern |
| Recommendations (`leagueAppearances[].recommendation`) | The real per-league `LeagueRecommendation.sourceFreshness`, from `assembleUserOsRecommendations()` — untouched by this phase | Whatever the User OS domain generator already computed |
| Headshot | Not freshness-tracked — a static/derived URL, not a live data claim |

A real, honest example this phase's own tests exercise: a player can have
a **fresh** roster-ownership row (the league synced 2 hours ago) but a
**stale** injury context (the `SportsPlayer` cache row expired 3 days
ago) — both facts are true simultaneously and both are surfaced
independently, never averaged or reduced to one number.

## Critical-action suppression

Every league-specific recommendation surfaced through
`leagueAppearances[].recommendation` already passed through User OS's own
`isFreshnessSafeForPriority()` gate before this module ever sees it — a
`critical`/`high` priority claim from a stale-synced league was already
suppressed or downgraded upstream. This module adds no second suppression
layer on top; it trusts the real gate the User OS phase already built and
tested.

## Injury status vocabulary is honestly narrower than the raw phase brief

The phase brief asks for `healthy`/`questionable`/`doubtful`/`out`/`ir`/
`suspended`/`day_to_day`/`unknown`. The real source
(`deriveAvailabilityCategory`, Decision OS F2.3) only distinguishes 4
real categories: `available`, `uncertain`, `unavailable`, `unknown`.
Mapping `uncertain`→`questionable` and `unavailable`→`out` was the most
defensible single choice without fabricating a distinction the source
data doesn't actually make — `doubtful`/`ir`/`suspended`/`day_to_day` are
never independently distinguishable from this real source today. This is
disclosed here rather than silently invented, and is the same real
limitation the Decision OS layer itself already documents
(`ADR_F2_3_INJURY_STATUS.md`).

## Snapshot-only leagues (Fantrax)

Not separately re-derived by this module — the real per-league
`syncFreshness` already reflects a Fantrax CSV import's true nature (a
snapshot import has no live resync capability, so its freshness clock
only ever moves toward `stale`, never resets to `fresh` — see the
Commissioner OS phase's `COMMISSIONER_OS_CONTENT_POLICY.md` for the full
mechanism, reused here unmodified).
