# Draft Identity Mapping Audit (Phase 26)

**Status: every transformation in the pipeline traced and documented from source this phase.**

## Every mapping/transformation stage, exact source

| Stage | Function/location | Transformation applied |
|---|---|---|
| ADP snapshot write | `lib/adp/computeAllFantasyAdp.ts:71-75`, `buildPlayerKey()` | `name.trim().toLowerCase()` + `\|` + `position.trim().toLowerCase()` — stored as `AllFantasyAdpSnapshot.playerKey` |
| ADP snapshot read | `lib/adp/readSnapshotForLeague.ts:77-95` | Splits the stored `playerKey` back into `{playerName, position}` for consumer shape; **position is `.toUpperCase()`'d** at this step (`readSnapshotForLeague.ts:82`) |
| Pool query | `lib/sport-teams/SportPlayerPoolResolver.ts:161-165` (post-fix) | `prisma.sportsPlayer.findMany({where: {sport}, orderBy: {name: 'asc'}})` — no `take` before dedup (Phase 26 fix) |
| Pool position normalization | `SportPlayerPoolResolver.ts:73-79`, `normalizePoolPosition()` | `.trim().toUpperCase()`, plus a small NFL-IDP-specific alias map (EDGE→DE, OLB/ILB/MLB→LB, SS/FS→S, NT→DT) — **no full-word-to-abbreviation mapping for any position** |
| Pool dedup | `SportPlayerPoolResolver.ts:170-180` | Keyed by `name.trim().toLowerCase()` + `\|` + `position.trim().toUpperCase()` + `\|` + `team.trim().toUpperCase()`, preferring the highest-`sportsPlayerQuality()` duplicate |
| Final join (ADP ↔ pool) | `lib/shared-services/draft/DraftContextAssembler.ts:85-87`, `playerKey()` | `name.trim().toLowerCase()` + `\|` + `position.trim().toLowerCase()` — **verified functionally identical to `buildPlayerKey()`** above |

## Confirmed: the two independently-implemented key-building functions are consistent

`buildPlayerKey()` (ADP side, `computeAllFantasyAdp.ts`) and `playerKey()` (pool-join side, `DraftContextAssembler.ts`) apply the exact same transformation. This was a real hypothesis worth checking (two independent implementations diverging is a classic source of exactly this kind of bug) — ruled out this phase by direct source comparison, not assumed.

## Confirmed: raw name strings are not independently canonicalized before the final key comparison

`SportsPlayer.name` flows into `PoolPlayerRecord.full_name` verbatim (no trim/suffix-strip/punctuation-strip at write time — `SportPlayerPoolResolver.ts:189`). Whatever raw string format a given import source wrote (e.g., `"Saquon Barkley"` vs. a hypothetical `"Saquon  Barkley"` with double-space, or `"Albert Okwuegbunam Jr."` vs. `"Albert Okwuegbunam"`) survives unchanged until the final `.trim().toLowerCase()` comparison. This is the structural reason suffix/punctuation variants (like the 1 `closeNameVariant` case measured) can occur, though they were a small minority of real failures this phase.

## No canonical, single source-of-truth identity table is consulted in this specific pipeline

Confirmed (re-verified, matching Phase 8's original finding): `getPlayerPoolForLeague()` does not call `lib/data/players.ts`'s `getPlayer`/`searchPlayers`, does not reference `PlayerIdentityMap` in its primary path (only as a supplementary IDP-position fallback, `SportPlayerPoolResolver.ts:237-302`), and does not touch FantasyCalc at all. The ADP and pool sides are two structurally independent systems that happen to use the same key-format convention — consistent, but not unified through one canonical identity service.
