# Full Product Blueprint — Phased Gap Audit — Phase 1: Canonical Data Layer & Event Architecture

**Status:** discovery only, no code changes made · **Prepared:** 2026-07-17 · **Branch:**
`claude/decision-os-activation-investigation`

## Headline finding

Same shape as Phase 0: **more already exists than a clean "gap," but it's split across multiple parallel
systems that don't fully cohere.** There are at least three distinct canonicalization efforts in this
codebase (Decision OS's `world/` layer, the `sports_core_*` Prisma tables, and `PlayerIdentityMap`) plus
a real transactional-outbox event bus — none of which is the single unified layer the blueprint imagines,
and at least one live user-facing path (Sleeper rosters) still speaks raw provider vocabulary end-to-end
rather than a canonical shape.

---

## 1. Canonical/normalized roster data model

**Partial — exists and is used for the DB/native path; bypassed end-to-end for the live-Sleeper path.**

- `app/api/league/roster/route.ts:25-42` types the live-Sleeper response with raw Sleeper fields
  (`roster_id`, `owner_id`, `players`, `starters`, `reserve`, `taxi`, `settings.waiver_budget_used`) and
  copies them through **verbatim** into `rosterPayload` (lines 463-480) — no translation step.
- `app/league/[leagueId]/tabs/TeamTab.tsx:134-239` re-declares the identical raw Sleeper shape
  client-side and reads `r.starters` / `r.players` / `r.reserve` / `r.taxi` directly — Sleeper's own
  vocabulary is the UI's vocabulary, not a canonical roster type. The same file also reads
  `rec.starters` / `rec.reserve ?? rec.ir` / `rec.taxi` off the "canonical" native `Roster.playerData`
  JSON blob (lines 174-190) — even the native-league storage format is Sleeper-shaped.
- For the non-Sleeper (`db`) path, the same route (lines 261-287) builds a real normalized DTO —
  `UnifiedPlayerWireDto` via `getNormalizedPlayerData` → `serializeUnifiedPlayerForApi`
  (`lib/player-data/serializeUnifiedPlayerForApi.ts:31-77`) — fields like `id`, `name`, `position`,
  `team`, `injuryStatus`, `projectedPoints`.
- Decision OS has its own origin-blind `RosterFacts` contract (`lib/decision-os/world/facts.ts:408-426`:
  `playerIds`, `starterIds`, `benchIds`, `reserveIds`, `taxiIds`) — the one place with a truly
  provider-agnostic roster shape, but it's a parallel system the app routes above don't consume.

**Net:** three roster shapes exist side by side (raw Sleeper, `UnifiedPlayerWireDto`, Decision OS
`RosterFacts`), and the one a real logged-in user's roster view actually renders through today is the
raw-Sleeper one for Sleeper-imported leagues.

## 2. Player-identity resolution

**Yes — a real ID-crosswalk exists, but there are two of them plus a separate ad hoc fallback tier.**

- `PlayerIdentityMap` (`prisma/schema.prisma:123-152`): canonical player row with `sleeperId` (unique),
  `fantasyCalcId`, `rollingInsightsId`, `apiSportsId`, `mflId`, `espnId`, `fleaflickerId`,
  `clearSportsId` side by side — this is the blueprint's exact concept.
- A second, newer crosswalk exists in parallel: `PlayerProviderIdentity`
  (`sports_core_player_provider_identities`, schema.prisma:15846-15875) — one row per
  (provider, sportKey, leagueKey, providerPlayerId) with its own `confidence`/`verified`/`aliases`.
- `lib/player-identity/playerIdentityResolution.ts` implements a genuine ad hoc fallback tier on top of
  both tables: `buildStrictPlayerKey`/`buildLoosePlayerKey` (name|position|team|sport string keys) with
  an explicit `IdentityMatchType = 'id' | 'strict' | 'loose' | 'none'` confidence ladder (1 / 0.9 / 0.5 /
  0) — i.e., name-string fuzzy matching is a designed, first-class degradation path, not an accidental one.
- `lib/decision-os/world/playerMetadata.ts:90-95` bypasses both ID-map tables entirely, indexing the
  `SportsPlayer` cache directly on raw `externalId`/`sleeperId` — a fourth, independent lookup path for
  the same problem.

**Net:** the identity-resolution *concept* is real and reasonably sophisticated (two crosswalk tables +
a documented confidence-scored fallback), but it is not a single system — three call sites solve player
identity three different ways.

## 3. Position-eligibility model

**Partial — canonical position is a flat string; slot/league eligibility is modeled separately, but only
fully for IDP.**

- Canonical position is a flat string everywhere: `Player.position` (schema.prisma:2702),
  `FantasyPlayer.position` (2189, with a bonus `fantasyPositions String[]` at 2190),
  `UnifiedPlayerWireDto.position: string | null`.
- League-level slot eligibility is modeled as its own concept:
  `lib/multi-sport/RosterTemplateService.ts:11-21` — `RosterTemplateSlotDto { slotName,
  allowedPositions[], starterCount, ... isFlexibleSlot }`, e.g. FLEX → `['RB','WR','TE']` (line 91),
  `IDP_FLEX` → `['DE','LB','CB','S']` (line 138). Consumed by `app/api/league/roster/route.ts:196-241` to
  compute `starterAllowedPositions` per league.
- A genuine per-player-per-league eligibility **override** exists, but only for IDP:
  `IdpPlayerEligibility` (schema.prisma:9340-9356) — `{ sportsPlayerId, leagueId, positionTags: Json,
  source }`, unique on `[sportsPlayerId, leagueId]`, with `leagueId = "__global__"` as a default. Offense
  positions have no equivalent override table — their eligibility is whatever `RosterTemplateSlotDto`
  says, with no per-league per-player exception path.

## 4. Data-freshness/confidence system (general, beyond Chimmy and beyond Decision OS)

**Yes — broad and applied consistently across two schema generations, with real gaps in the import layer.**

- Legacy cache tables already carry freshness fields: `SportsInjury` (`fetchedAt`/`expiresAt`,
  schema.prisma:213-214), `SportsPlayerRecord` (`lastUpdated`), `AdpDataRecord`
  (`confidenceScore`/`providerCount`/`providerBreakdown`, lines 362+).
- The newer `sports_core_*` canonical layer (schema.prisma:15668-16272) — `Game`, `LiveGameState`,
  `PlayerSeasonStat`, `InjuryReport`, `PlayerNewsItem`, `AIEvidenceItem` — carries a consistent quintet on
  every table: `confidence`, `fetchedAt`, `expiresAt`, `sourceUpdatedAt`, `lastSeenAt`.
  `SportsProviderHealth` (16216-16239) tracks per-provider `freshnessStatus`/`coveragePct` directly.
  `AIEvidenceItem` additionally has explicit `stale`/`allowed` gate booleans.
- **Gap, confirmed absent:** import/roster snapshot tables — `LegacyLeague`, `LegacyRoster`,
  `FantraxLeague`, `YahooLeague`/`YahooTeam`, `SleeperImportCache` — carry only bare `createdAt`/
  `updatedAt`. A user's imported league snapshot has no source-freshness or confidence metadata at all,
  which directly corroborates the Phase 2 import-sync question below (no visible way to know an imported
  snapshot is stale from the data itself).

## 5. Domain events / pub-sub

**Yes — a real transactional-outbox event bus exists, but it covers league/roster/trade/competition
lifecycle events, not sports-data ingestion (injuries/projections/scores).**

`lib/events/` — `IEventBus`/`IOutboxStore`/`EventConsumer` contract requiring idempotent consumers
(`types.ts:184-187`); `catalog.ts:17-70` defines `ROSTER_PLAYER_ADDED`, `TRADE_ACCEPTED`,
`MATCHUP_FINALIZED`, `STANDINGS_UPDATED`, `DRAFT_STARTED`/`COMPLETED`, `AUTH_REGISTERED`,
`SETTINGS_CHANGED`, and more.

Traced one real chain end-to-end: `lib/redraft/standingsEngine.ts:129` emits `STANDINGS_UPDATED` →
`PlatformEventProducer.emit` (`lib/events/producers.ts:82-90`) persists to the outbox →
`scripts/run-outbox-relay.ts:52-61` drains it via `OutboxRelay` with `[auditConsumer,
intelligenceConsumer]` → `lib/intelligence/projections/snapshotProjection.ts:143-164` idempotently
rebuilds intelligence snapshot tables.

**Confirmed gap:** the event catalog has no `player.injury_changed` or equivalent — sports-data ingestion
is not wired into this bus. A roster/trade/draft/standings change fans out through real events; an
injury update does not trigger anything downstream through this mechanism.

## 6. Provider-conflict resolution

**Yes, for injury/news data specifically — genuinely not "last write wins."**

`lib/news-injury-aggregation/mergeLayer.ts` — `AUTHORITY` source-trust ranking (lines 17-23),
`confidenceForKind` per-source-type confidence (29-48; e.g. `injury_report_record`: 0.92 vs
`player_news`: 0.5), `pickWorstCanonical` (56-68, resolves by most-severe-status, not most-recent),
`detectConflict` (70-102, flags disagreement between two ≥0.65-confidence sources with a ≥30 severity
spread, surfaced as `conflict`/`conflictDetail` on the output).

Separately, `lib/providers/providerPriority.ts` + `providerFallbackPolicy.ts` define static per-domain
precedence chains (e.g. `NFL_CHAIN`: `rolling_insights > thesportsdb > clearsports > sleeper >
internal`), with an explicit stated rule: *"Lower tiers must not overwrite non-empty higher-tier fields
unless metadata marks the current value stale/low-confidence."*

Confirmed this is distinct from Decision OS's `core/parity/` (shadow-vs-legacy comparison — an unrelated
kind of conflict). Not verified: whether every individual sync job actually respects these chains at
write time, versus a simpler upsert path elsewhere — that would require tracing every ingestion call
site, out of scope for this pass.

## 7. What this means for the rest of the phased audit

Same re-scoping implication as Phase 0: expect **parallel, partially-overlapping systems** rather than
clean gaps almost everywhere in this codebase. Three canonicalization efforts for player/roster data
exist simultaneously (Decision OS `world/`, `sports_core_*`, `PlayerIdentityMap` + ad hoc fallback) and
none of them is what the live Sleeper-roster UI path actually renders through. Phase 2 (Import &
Synchronization OS) should treat "does per-provider freshness exist" as **already answered here as
partial-no** for import snapshot tables specifically (§4) — that's a real, confirmed gap, not a
hypothesis to re-derive.

## 8. Explicitly not covered by this pass

No fixes made. No exhaustive trace of every ingestion call site against the provider-precedence chains
in §6. No check of whether `PlayerIdentityMap` vs `PlayerProviderIdentity` (§2) is a deliberate
migration-in-progress or accidental duplication — that would need commit-history/author-intent research,
out of scope for a code-existence pass. Phases 2-8 of the larger blueprint audit have not been started.
