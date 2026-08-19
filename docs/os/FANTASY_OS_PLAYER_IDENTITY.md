# Canonical Player Identity Resolution (Phase 14)

**Status: implemented, real-data validated against the same real Sleeper league used in Phase 13, and against 2 additional structurally-distinct real rosters in Phase 16. One real consumer migrated (`WaiverContextAssembler.ts`, flat-shape branch only). No other domain touched.**

**Phase 16 update:** re-validated against 2 additional real rosters (22 and 33 real players respectively, vs the original 27) — 100% resolution for both (0/22, 0/33 unresolved), no ambiguous matches, no identity defect found. See [`FANTASY_OS_WAIVER_MULTI_LEAGUE_VALIDATION.md`](FANTASY_OS_WAIVER_MULTI_LEAGUE_VALIDATION.md).

## Why this phase

Phase 13's real Sleeper validation found that raw Sleeper player ids (e.g.
`"10216"`) don't resolve against the sport-wide player pool
(`SportPlayerPoolResolver`, keyed by `SportsPlayer.id`) used elsewhere in the
Waiver assembler — a local, disclosed-not-fixed gap. This phase builds one
authoritative, reusable resolver to close that gap correctly, rather than
patching the symptom again locally.

## Audit findings (read the real code first, assumed nothing)

The brief assumed a single "temporary local fallback" existed. The real
picture is far more fragmented — **at least six independent, non-communicating
player-resolution mechanisms** exist in this codebase today:

| Mechanism | File | Status |
|---|---|---|
| `resolveCanonicalPlayerId`/`s` | `lib/league-import/playerIdResolver.ts` | **Dead code** — only reachable via the facade below, itself uncalled |
| `resolvePlayerIdentity`/`resolvePlayerIdentities` | `lib/shared-services/identity/PlayerIdentityService.ts` (Phase 1) | **Dead code** — zero real callers, confirmed by the Phase 1 memory and re-confirmed here |
| `lookupBySleeperId(s)`/`lookupByName(s)`/`syncIdentityMap` | `lib/unified-player-service.ts` | Live, but **only** for the `/api/legacy/*` surface (`af-legacy` pages) — not the main production app |
| `resolvePlayerIdentity`/`resolvePlayerIdentityBatch` | `lib/fantasy-data/playerIdentityResolver.ts` | **Dead code** — a 4th, separate direct-Prisma resolver, nothing imports it |
| Key normalization (not DB-backed) | `lib/player-identity/playerIdentityResolution.ts` | Live — consumed by the Draft domain's own resolution chain |
| Bespoke inline resolution | `lib/live-draft-engine/resolveDraftPickPresentation.ts`, `lib/draft-room/getResolvedDraftPoolForLeague.ts` (~1800 lines), `lib/trade-engine/convertSleeperToAssets.ts`, `lib/fantasycalc.ts`'s `findPlayerByName`/`findPlayerBySleeperId` | Live, each independently reimplements matching logic |

**None of these were modified or consolidated this phase** — the brief's
explicit scope is to build the new canonical resolver and migrate Waiver
only. This table is a real map for whoever does the next consolidation pass.

### Why a new `lib/shared-services/player-identity/` directory, not extending `lib/shared-services/identity/`

`PlayerIdentityService.ts` (Phase 1) is real but too thin (bare
`canonicalPlayerId` + confidence, no hydrated player object) and has zero
callers — safer to supersede with a properly-scoped module than to graft a
much richer contract onto dead code. It is left in place (removing
live-looking code without an explicit instruction is riskier than leaving a
documented, superseded facade) but should be considered deprecated for any
new work.

### Per-domain reality (does this domain resolve player identity today, and how)

- **Waiver**: no identity resolution anywhere in `waiver-wire`/`waiver-engine`/`waiver-ai-engine` — `playerId` is treated as an already-resolved opaque string. `WaiverContextAssembler.ts` (Phase 7/13) is the only real identity-adjacent logic, now migrated onto the new resolver.
- **Trade**: no `PlayerIdentityMap` usage. The live production trade engine (`lib/engine/trade.ts`) does its own ad hoc name normalization on client-supplied data and never touches `PlayerIdentityMap` at all.
- **Draft**: two more independent implementations (`resolveDraftPickPresentation.ts`, `getResolvedDraftPoolForLeague.ts`), neither using the new resolver.
- **Game Day / matchups / lineups**: no identity resolution — raw provider-native ids are stored directly in `WeeklyScore`/`PlayerWeeklyScore` at sync time.
- **Exposure tracking** (`UserPlayerExposureService.ts`): keys purely by the raw roster-JSON id — a real cross-provider fragmentation risk for a user with leagues on multiple providers, not addressed this phase.
- **Commissioner**: no player-level resolution — league/roster aggregate only.
- **Knowledge Graph**: raw id/name passthrough, no resolution.
- **Import normalization** (`DefaultExternalIdentityMapper.ts`): bypasses `PlayerIdentityMap` entirely, building a synthetic `${provider}:player:${source_id}` key — the import pipeline's identity space is disconnected from the canonical system from the start.
- **Sport-wide pool** (`SportPlayerPoolResolver.ts`): mixes two keying schemes internally (`SportsPlayer.id` primary, `PlayerIdentityMap.id` as a secondary IDP-position gap-filler).

None of the above were migrated this phase — documented, not touched, per the brief's explicit scope boundary.

## Architecture

```
lib/shared-services/player-identity/
  types.ts               — ProviderPlayerRef, CanonicalPlayer, ResolutionResult,
                            ResolutionConfidence, ResolutionSource, IdentityDiagnostics,
                            ProviderCapability, AliasMap
  ProviderAdapters.ts     — real, confirmed per-provider direct-id capability table
  ResolutionCache.ts      — InMemoryResolutionCache (matches every prior shared-service's
                            in-memory-store pattern)
  PlayerIdentityResolver.ts — resolvePlayer() / resolvePlayers() (batched)
  index.ts, README.md
```

### Resolution strategy (deterministic; `unresolved` is always explicit, never fabricated)

1. **Direct id** against `PlayerIdentityMap`'s provider-specific column (`sleeperId`/`espnId`/`mflId`/`fleaflickerId` — confirmed real columns via `prisma/schema.prisma`).
2. **Cache** short-circuit for an already-resolved `provider:sourceId` pair.
3. **Direct id** against `SportsPlayer.sleeperId` — a real, second Sleeper-only source, confirmed via a real query against the Phase 13 validation league (2 of 10 real starters were in `SportsPlayer` but missing from `PlayerIdentityMap`). A match here has no canonical cross-provider UUID yet, so `canonicalPlayerId` is a synthetic `sportsplayer:<provider>:<id>` string — reported honestly via `diagnostics.reason`, never disguised as a real `PlayerIdentityMap` UUID.
4. **Name/team/position fallback** against `PlayerIdentityMap`, reimplementing (not importing, to stay dependency-free of the legacy-only surface) the same real disambiguation scoring already proven in `lib/unified-player-service.ts`'s `disambiguateCandidate`.
5. **Alias map** — optional, injectable, **empty by default**. No persisted historical-alias store exists in this schema today (confirmed during the audit). A real extension point, not a fabricated capability.
6. **Confidence scoring** — `direct` / `name_match_confident` / `name_match_ambiguous` / `unresolved`, computed from which step matched and whether disambiguation was unambiguous.

## Provider coverage (real, not assumed)

| Provider | Direct-id sources | Name-match fallback |
|---|---|---|
| Sleeper | `PlayerIdentityMap.sleeperId`, `SportsPlayer.sleeperId` | Yes |
| ESPN | `PlayerIdentityMap.espnId` | Yes |
| MFL | `PlayerIdentityMap.mflId` | Yes |
| Fleaflicker | `PlayerIdentityMap.fleaflickerId` | Yes |
| Yahoo | **None** — real, disclosed gap (no `yahooId` column exists) | Yes only |
| Fantrax | **None** — real, disclosed gap (no `fantraxId` column exists) | Yes only |

Closing the Yahoo/Fantrax gap requires a schema migration — out of scope for this additive phase, exactly as Phase 1 already documented.

## What this resolver does NOT do

- Never leaks a provider-specific object — public contract is `ProviderPlayerRef` in, `CanonicalPlayer`/`ResolutionResult` out, always.
- Never calls a live provider API — database lookups only.
- Never writes to `PlayerIdentityMap` or `SportsPlayer` — read-only.
- Does not migrate Trade, Draft, Game Day, Commissioner, or the Knowledge Graph onto it this phase.
- Does not add historical aliases — the extension point exists, the data does not.

## Consumer migration: `WaiverContextAssembler.ts` only

Replaced the Phase 13 local `poolById` (keyed by `SportsPlayer.id`, which
never intersects a raw Sleeper numeric id) with batched calls to
`resolvePlayers()`. `toWaiverRosterPlayers` became `async`; provider is
derived from `League.platform`, guarded so non-provider platforms
(`manual`/`allfantasy`/`native`) never call the resolver at all (real, tested
via `'never calls the identity resolver for a non-provider platform'`).

## Real-data validation (re-ran Phase 13's exact same 21 requests, same real league)

| Metric | Phase 13 (pre-resolver) | Phase 14 (post-resolver) |
|---|---|---|
| Real Sleeper roster player resolution rate | Most players showed `Player <id>`/`UNKNOWN` | **100% (0/567 unresolved across 21 requests × 27 players)** |
| HTTP status | 21/21 `200` | 21/21 `200` |
| Shadow-compare status distribution | 22/22 `equivalent` | 14/21 `equivalent`, 7/21 `acceptable_variance`, **0** `material_divergence`/`shadow_execution_failure`/`insufficient_context` |
| Shared-service duration (median / p95) | 751ms / 1,342ms | **501ms / 670ms** (faster — indexed direct-id lookups vs. the old free-agent-pool-name-matching path) |
| Total seam duration (median / p95) | 967ms / 1,442ms | 619ms / 882ms |

### Why the shadow-compare status distribution changed — a real, honest finding, not a regression

**Update (Phase 15): this gap is now closed.** See [`FANTASY_OS_DECISION_CONTEXT.md`](FANTASY_OS_DECISION_CONTEXT.md) — `currentWeek`/`goal`/`maxResults` are now forwarded through a dedicated `WaiverRequestContext`, and re-validation against this same real league returned `equivalent` to 21/21 (100%).

Investigated directly rather than assumed: the Phase 12 seam's call —
`evaluateWaiverShadow({ leagueId: args.leagueId, rosterId: facts.rosterId })`
in `lib/decision-os/waiver/sharedServiceShadowCompare.ts` — **never forwards
`currentWeek`/`goal`**, by deliberate design (only identity fields cross that
boundary, a real Phase 12 security decision, not an oversight). The shared
service therefore always evaluates as `currentWeek=1, goal='balanced'`
(the assembler's defaults), regardless of what the authoritative
(client-supplied) request actually asked for.

In Phase 13, every roster's positions were mostly `UNKNOWN` (the un-fixed
identity gap), so `computeTeamNeeds`'s position-driven weighting had almost
no real signal to work with — both sides converged on similar,
data-starved recommendations regardless of week/goal, making the comparison
look artificially perfect (22/22 `equivalent`). Now that positions resolve
correctly, `computeTeamNeeds` produces real, week/goal-sensitive
recommendations — and the shared service's fixed week-1/balanced evaluation
now visibly, honestly diverges from authoritative requests for other
weeks/goals. **This is a pre-existing Phase 12 seam characteristic, newly
made visible by better data — not a bug introduced by the resolver, and not
a regression in resolution accuracy.** It is out of this phase's explicit
scope to fix (only `WaiverContextAssembler.ts` was to be migrated); flagged
here for whoever picks up the seam's own scope next.

Every one of the 7 `acceptable_variance` events is real, not `material_divergence`
— the shared service's top pick was still found somewhere in the
authoritative engine's own ranked list, just not literally rank 1 for a
different week/goal context. `material_divergence`, `shadow_execution_failure`,
and `insufficient_context` all remained at 0/21 (0%).

## Performance impact

Faster, not slower: the resolver's direct indexed lookups against
`PlayerIdentityMap`/`SportsPlayer` replace what was previously a large,
unindexed free-agent-pool linear scan for the flat-shape branch. No new
latency bound was needed; the existing 4,000ms shadow-compare timeout was
never approached (p95 882ms total, well under the bound).

## Rollback

Unchanged from Phase 12/13: `SHARED_SERVICES_WAIVER_SHADOW_COMPARE` is the
complete rollback mechanism. The new resolver has no code path reachable
outside `WaiverContextAssembler.ts`'s flat-shape branch, which itself is only
ever invoked when that flag is enabled — already proven in Phase 13, and
nothing about that flag's mechanics changed this phase. No new flag was
added or is needed for the resolver itself.

## Tests added

`__tests__/shared-services/player-identity/PlayerIdentityResolver.test.ts`
(20 tests): provider ID resolution, `SportsPlayer` direct fallback, UUID/
canonical resolution, alias resolution (present and absent), unresolved
handling, duplicate-name disambiguation (confident and ambiguous), confidence
scoring, cache behavior (hit/expiry/clear), provider neutrality, and batched
resolution (including the N+1-avoidance assertion). Plus 2 new tests in
`waiver-context-assembler.test.ts` covering the resolver integration
(unresolved-honesty, non-provider-platform guard).

## Future consolidation candidates (documented, not started)

- Deprecate/remove `lib/shared-services/identity/PlayerIdentityService.ts` and `lib/league-import/playerIdResolver.ts` (confirmed dead code).
- Migrate `lib/unified-player-service.ts`'s legacy-surface callers onto this resolver.
- Migrate Draft's two independent resolution chains onto this resolver.
- Close the Yahoo/Fantrax direct-id gap (requires a schema migration).
- Connect `DefaultExternalIdentityMapper.ts`'s import-time `stable_key` space to `PlayerIdentityMap` so newly-imported players get a canonical id at import time, not only at read time.
