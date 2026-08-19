# Player Identity Resolution — Fantasy OS Phase 14

The one authoritative, provider-neutral entry point for resolving a provider
player reference (e.g. a raw Sleeper numeric id, an ESPN id, or just a name)
to a canonical player. Built because Phase 13's real Sleeper validation
exposed a real gap: raw Sleeper player ids don't resolve against the
sport-wide player pool used elsewhere in the app.

## Why a new module, given `lib/shared-services/identity/PlayerIdentityService.ts` already exists

The Phase 14 audit (read the pre-existing code directly, not assumed) found
**`lib/shared-services/identity/PlayerIdentityService.ts` has zero real
callers** — a thin, additive facade shipped in Phase 1 that nothing in the
app ever ended up calling. It also only returns a bare `canonicalPlayerId` +
confidence, not a hydrated player object (name/team/position/sport) — too
thin for what this phase's consumers need. Rather than duplicate it blindly,
this module supersedes it: richer contract, real provider-capability table,
a cache, and diagnostics. `PlayerIdentityService.ts` is left in place
(deleting live-looking code without an explicit instruction is riskier than
leaving a documented, superseded facade) but should be considered deprecated
in favor of this module for any future work.

## The wider landscape (found, not touched)

The audit also found the codebase has **at least six other independent,
non-communicating player-resolution mechanisms** — `lib/league-import/playerIdResolver.ts`
(dead, only reachable via the dead facade above), `lib/unified-player-service.ts`
(live, but only for the `/api/legacy/*` surface), `lib/fantasy-data/playerIdentityResolver.ts`
(dead), `lib/player-identity/playerIdentityResolution.ts` (live, Draft-domain
normalization helper — not DB-backed), plus bespoke inline logic in
`lib/live-draft-engine/resolveDraftPickPresentation.ts`,
`lib/draft-room/getResolvedDraftPoolForLeague.ts`, `lib/trade-engine/convertSleeperToAssets.ts`,
and the canonical valuation gateway's `findPlayerByName`/`findPlayerBySleeperId`. **None
of these were modified or migrated this phase** — the brief's explicit scope
is Waiver only. They're documented here as a real map for whoever picks up
the next consolidation phase, not silently ignored.

## Real data sources (confirmed by reading `prisma/schema.prisma` directly)

- `PlayerIdentityMap` — the canonical cross-provider table. Has dedicated
  columns for `sleeperId` / `espnId` / `mflId` / `fleaflickerId`. **Has no
  `yahooId` or `fantraxId` column** — a real, pre-existing gap (first
  documented in the Phase 1 Identity Service, confirmed still true here).
  Closing it needs a schema migration — out of scope for this additive phase.
- `SportsPlayer` — a separate, independently-populated table that also has
  its own `sleeperId` column. Confirmed via a real query against the Phase 13
  validation league: 2 of that league's 10 real starters were missing from
  `PlayerIdentityMap` but present in `SportsPlayer` — a real, second direct-id
  source for Sleeper specifically (see `ProviderAdapters.ts`).

## Resolution strategy (deterministic, never fabricates a mapping)

1. Direct id match against `PlayerIdentityMap`'s provider column.
2. Cache short-circuit for a previously-resolved `provider:sourceId` pair.
3. Direct id match against `SportsPlayer.sleeperId` (Sleeper only — see
   above). A match here has **no** canonical cross-provider UUID yet, so
   `canonicalPlayerId` is a synthetic `sportsplayer:<provider>:<id>` string,
   not a `PlayerIdentityMap` UUID — reported honestly via `diagnostics.reason`,
   never disguised as a real canonical id.
4. Normalized name (+ team/position when available) match against
   `PlayerIdentityMap`, using the same real disambiguation approach already
   proven in `lib/unified-player-service.ts`'s `disambiguateCandidate`
   (reimplemented here, not imported, to keep this module dependency-free of
   the legacy-surface-only file).
5. Optional injectable alias map (`ResolveOptions.aliasMap`) — **empty by
   default**. No persisted historical-alias store exists in this schema
   today (confirmed during the audit). This is a real extension point, not a
   fabricated "aliases work" claim.
6. Confidence scoring — `direct` / `name_match_confident` /
   `name_match_ambiguous` / `unresolved`. `unresolved` is always an explicit,
   real outcome with a non-blank `diagnostics.reason` — never silently
   coerced into a guessed match.

## Provider coverage

| Provider | Direct-id sources | Name-match fallback |
|---|---|---|
| Sleeper | `PlayerIdentityMap.sleeperId`, `SportsPlayer.sleeperId` | Yes |
| ESPN | `PlayerIdentityMap.espnId` | Yes |
| MFL | `PlayerIdentityMap.mflId` | Yes |
| Fleaflicker | `PlayerIdentityMap.fleaflickerId` | Yes |
| Yahoo | None (real gap, disclosed) | Yes only |
| Fantrax | None (real gap, disclosed) | Yes only |

## What this module does NOT do

- Never leaks a provider-specific object — the public contract is
  `ProviderPlayerRef` in, `CanonicalPlayer`/`ResolutionResult` out, always.
- Never calls a provider's live API — this is a database-lookup resolver
  only, same posture as every prior shared-service phase.
- Does not write to `PlayerIdentityMap` or `SportsPlayer` — read-only.
- Does not migrate Trade, Draft, Game Day, Commissioner, or the Knowledge
  Graph onto it this phase — `WaiverContextAssembler.ts` is the only real
  consumer migrated in Phase 14.

## Cache

`InMemoryResolutionCache` — per-process, in-memory, 5-minute TTL by default.
Matches the established in-memory-store pattern from every prior shared
service (e.g. `WaiverShadowResultStore.ts`). Not persisted, not distributed;
a restart clears it. This is an accepted, documented limitation.
