# Cross-League Player Intelligence Architecture

Date: 2026-07-13. The universal "My Players" workspace — one canonical
view of every player a user rosters across every connected league and
provider, with exposure, injury, bye-week/schedule, and league-specific
action intelligence.

## The shape

```
Request (appUserId from session)
    ↓
assembleCrossLeaguePlayerPortfolio()  — the one coordinator every consumer calls
    ↓
resolveLinkedPlatformUserIds()        — real user→platform-id linkage (reused, not re-derived)
    ↓
prisma.roster.findMany() across ALL connected leagues
    ↓
getNormalizedLineupSections()         — real, battle-tested roster parser (reused)
    ↓
resolvePlayers()                      — real canonical identity resolution (reused)
    ↓  (grouped by canonicalPlayerId)
resolveInjuryContext() + resolveScheduleContext() + assembleUserOsRecommendations() — real enrichment (reused, per player/per league)
    ↓
CrossLeaguePlayerPortfolioItem[]
```

`lib/shared-services/league-hub/crossLeaguePlayerPortfolio.ts`'s
`assembleCrossLeaguePlayerPortfolio({ appUserId, sport?, provider?, season?
})` is the single entry point — the API routes, the `/my-players`
workspace, the League Hub summary card, and the Chimmy seam all call this
one function.

## Why this is an enrichment layer, not a fresh roster-reading path

This phase's Part 1 inventory found
`lib/shared-services/game-day/UserPlayerExposureService.ts` — a real,
complete, SHADOW-MODE-ONLY cross-league exposure engine (Fantasy OS
Migration Plan, Phase 9) with **zero live consumers**, confirmed by grep:
only its own module and a doc file reference it. Its own
`UserPlayerExposure` type already stubs `injuryStatus`/`gameWindow`/
`leaguesRequiringAttention` to `null`/`[]`, anticipating exactly this
phase's enrichment. Per the explicit "do not build duplicate engines when
usable implementations already exist" guardrail, this phase gives that
service its first real consumer rather than re-deriving cross-league
roster aggregation from scratch:

- `resolveLinkedPlatformUserIds` — exported (was module-private) from
  `UserPlayerExposureService.ts` so this module can reuse the exact same
  real user-to-platform-id linkage instead of re-deriving it.
- `getNormalizedLineupSections` (`lib/roster/LineupTemplateValidation.ts`,
  Waiver OS Phase 7) — the battle-tested dual-shape roster parser. Handles
  both the `lineup_sections`-normalized shape and Sleeper's flat `players`/
  `starters`/`taxi`/`reserve` array shape — a real gap Phase 33 found and
  fixed the hard way (2 of 3 real test leagues used the flat shape).

## The one genuinely new piece: canonical, cross-provider identity

`UserPlayerExposureService.ts` aggregates by **raw provider player id** —
the same real player rostered via Sleeper in one league and ESPN in
another appears as two separate entries there. This module resolves every
roster player through `lib/shared-services/player-identity/`'s real
`resolvePlayers()` (Phase 14) and aggregates by `canonicalPlayerId`
instead. Never merges by display name alone — an ambiguous or unresolved
match keeps its own stable, provider-scoped synthetic id
(`unresolved:<provider>:<providerId>`) rather than being silently folded
into a different player's row. See `CANONICAL_PLAYER_IDENTITY_CONTRACT.md`
for the full resolution/dedup contract.

## Real enrichment sources, not a raw `InjuryReportRecord` join

`userOsContext.ts` (User OS phase) joins injury data on
`InjuryReportRecord.playerId` — documented
(`ADR_F2_3_INJURY_STATUS.md`) to be in an API-Sports id space that does
**not** match roster player ids. This module instead reuses the real,
already-solved Decision OS F2.2/F2.3 read-only world layers:
`resolveInjuryContext(sport, ids)` (keyed by either `externalId` or
`sleeperId`, honestly degrades to `unknown`/`null` on a miss, never
throws) and `resolveScheduleContext({sport, season, currentWeek, teams})`
(real bye-week derivation, NFL-only — see
`CROSS_LEAGUE_PLAYER_SUPPORT_MATRIX.md`).

## League-specific recommendations, never one universal action

Part 8's explicit requirement — the same player can need a different
action in different leagues (start in a deep league, bench in a shallow
one, sell in a rebuild). This module calls the real, existing
`assembleUserOsRecommendations()` **once per distinct league** the user
has a roster in, then filters each league's bundle down to entries whose
`playerIds` include this specific player — never a second recommendation
engine, never a single recommendation broadcast across every league
appearance.

## Headshots

Reuses `lib/players/getPlayerImage.ts` — the same UI-facing resolver every
other roster surface in this app already uses (prefers a real `imageUrl`
from the roster's own raw provider data when present and classified as a
headshot, else derives a real Sleeper headshot URL from a numeric Sleeper
id, else `null` to trigger the existing letter/initial fallback). The
deeper, governed `lib/sports-data-gateway/canonical/canonicalImage.ts`
policy layer (4-tier source precedence) was evaluated but not wired this
phase — it requires pre-resolved candidate URLs from multiple sources this
phase's roster-reading path doesn't safely have; a real, disclosed scoping
decision, not an oversight.

## What this phase does NOT touch

No changes to `lib/shared-services/game-day/GameDaySnapshotService.ts` or
any other consumer of `UserPlayerExposureService.ts` (still shadow-mode
for its own original purpose). No schema migration to add Yahoo/Fantrax
direct-id columns to `PlayerIdentityMap` (a real, disclosed gap — see
`CANONICAL_PLAYER_IDENTITY_CONTRACT.md`). No changes to
`lib/decision-os/world/*` — read-only consumer only. No start of the
global provider-agnostic Rankings migration.
