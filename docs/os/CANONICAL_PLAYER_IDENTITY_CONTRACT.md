# Canonical Player Identity Contract (Cross-League Player Intelligence)

Date: 2026-07-13. Documents how `crossLeaguePlayerPortfolio.ts` resolves
and deduplicates player identity across providers — reusing, not
replacing, the real Phase 14 `lib/shared-services/player-identity/`
resolver.

## Reused, not rebuilt

`resolvePlayers(refs: ProviderPlayerRef[])` — real, Phase 14, exported
from `lib/shared-services/player-identity`. Each `ProviderPlayerRef` is
`{provider, sourceId, nameHint, positionHint, teamHint, sport}`, built
from one real roster row. This phase does not call, extend, or duplicate
`lib/sports-data-gateway/resolution.ts` (a separate, real, but confirmed
**unwired** resolver with zero callers anywhere in `app/`/`lib/`) or
`lib/shared-services/identity/PlayerIdentityService.ts` (confirmed
deprecated/superseded by its own Phase 14 README, no external callers).

## Resolution confidence, mapped honestly

`ResolutionConfidence` (player-identity's real, computed tiers) mapped
onto this phase's requested `IdentityConfidence` vocabulary — never a
second confidence model invented:

| Real `ResolutionConfidence` | This phase's `IdentityConfidence` | Meaning |
|---|---|---|
| `direct` | `verified` | Matched a real provider-id column on `PlayerIdentityMap` or `SportsPlayer` |
| `name_match_confident` | `mapped` | Normalized-name match, exactly one best-scoring candidate |
| `name_match_ambiguous` | `ambiguous` | Multiple tied candidates — a best-guess is still returned, never silently dropped |
| `unresolved` | `unresolved` | No candidate found by any strategy |

## Deduplication rule

Every raw roster row is grouped by its resolved `canonicalPlayerId`. When
resolution fails (`player: null`), the row keeps a stable, provider-scoped
synthetic id — `unresolved:<provider>:<providerId>` — rather than being
merged into any other player's row. **Never merges by display name
alone.** Two rows with the same name but different, both-unresolved
identities remain two separate portfolio items — a real, deliberate
safety choice over risking a false merge.

## The real, disclosed provider gap

`PlayerIdentityMap` (the canonical table backing `resolvePlayers()`) has
real direct-id columns for `sleeperId`, `espnId`, `mflId`,
`fleaflickerId`, `fantasyCalcId`, `rollingInsightsId`, `apiSportsId`,
`clearSportsId` — **no `yahooId` or `fantraxId` column exists**. A Yahoo-
or Fantrax-imported roster row therefore always falls back to
name/team/position matching, never a direct-id match, and will more often
resolve as `mapped`/`ambiguous`/`unresolved` than `verified`. This is a
real schema gap, not a bug in this phase's logic — a future phase adding
those columns (and a real Yahoo/Fantrax player-id backfill) would directly
raise identity confidence for those two providers. Disclosed here and in
`CROSS_LEAGUE_PLAYER_SUPPORT_MATRIX.md`, not silently worked around.

Also disclosed: even Sleeper has two real, independent id sources
(`PlayerIdentityMap.sleeperId` and `SportsPlayer.sleeperId`) that are not
guaranteed to always resolve to the identical canonical id in every case —
`resolvePlayers()`'s own real resolution order handles this, but a
`SportsPlayer`-only match (no `PlayerIdentityMap` row) can surface a
synthetic, non-UUID canonical id shape rather than a true
`PlayerIdentityMap.id`. This phase's dedup logic keys on whatever
`canonicalPlayerId` `resolvePlayers()` actually returns — it does not
attempt to further reconcile the two id spaces itself.

## Never a second identity system

This module holds no player-identity state of its own — no local alias
table, no local name-normalization cache beyond what `resolvePlayers()`
already provides. Every identity decision traces to a real call into the
existing Phase 14 resolver.
