# G48 NFL Redraft Provider Evidence Packets

## Purpose

G48 creates canonical provider evidence packets for the AF NFL Redraft League. These packets are facts-only records for future OS consumers, premium services, audits, debugging, and operational tooling.

G48 does not build Decision OS, Manager OS, Commissioner OS, recommendations, AI reasoning, or War Room features.

## Architecture

Evidence packets are generated from canonical AllFantasy models only:

```text
Provider payload
  -> G45 provider foundation
  -> G46A identity mapping
  -> G46B media/metadata
  -> G46C player intelligence
  -> G47A game/weather context
  -> G47B live scoring/stat correction context
  -> G48 evidence packet
```

Provider payloads do not flow into React components or OS consumers.

The implementation lives in:

- `lib/player-data/nflRedraftProviderEvidencePackets.ts`

It is exported from:

- `lib/player-data/index.ts`

## Evidence Packet Schema

Each packet includes:

- evidence ID
- evidence type
- canonical league ID
- canonical team ID
- canonical player ID
- canonical game ID
- canonical matchup ID
- source provider
- provider capability/domain
- source timestamp
- ingested timestamp
- freshness status
- stale status
- missing status
- fallback status
- confidence level
- affected surfaces
- canonical field names included
- fact payload
- provider error metadata when applicable
- retry/rate-limit metadata when applicable
- optional internal debug archive key

Evidence IDs are deterministic from packet type, canonical IDs, source provider, and included field names.

## Packet Types

G48 supports:

- `player_identity`
- `player_metadata_media`
- `projection`
- `injury`
- `news`
- `ranking_adp`
- `schedule_game_context`
- `weather`
- `live_stats`
- `fantasy_scoring`
- `stat_correction`
- `roster_context`
- `matchup_context`
- `waiver_context`
- `trade_context`
- `draft_context`

## Data Flow

Use the specific builders when a consumer already has a canonical object:

- `buildPlayerIdentityEvidencePacket`
- `buildPlayerMetadataMediaEvidencePacket`
- `buildProjectionEvidencePacket`
- `buildInjuryEvidencePacket`
- `buildNewsEvidencePacket`
- `buildRankingAdpEvidencePacket`
- `buildScheduleGameEvidencePacket`
- `buildWeatherEvidencePacket`
- `buildLiveStatsEvidencePacket`
- `buildFantasyScoringEvidencePacket`
- `buildStatCorrectionEvidencePacket`
- `buildSurfaceContextEvidencePacket`

Use packet-set builders for broader surfaces:

- `buildNflRedraftProviderEvidencePacketsFromCanonical`
- `buildNflRedraftProviderEvidencePacketsFromWire`

The wire helper still reads canonical fields from `UnifiedPlayerWireDto`; it does not expose raw provider records.

## What Is Intentionally Excluded

Evidence packets do not include:

- raw provider payloads
- provider secrets
- provider-specific player IDs by default
- recommendations
- conclusions
- AI reasoning
- LLM summaries
- rankings interpreted as advice
- War Room logic

An internal debug reference may include a provider archive/cache key when a caller explicitly passes one. The archive key is a pointer, not the payload itself.

## Future OS Consumption

Future Commissioner OS, Manager OS, and Decision OS work should consume these packets as factual evidence only.

OS consumers should:

- treat `facts` as canonical AllFantasy data
- inspect `freshnessStatus`, `stale`, `missing`, and `fallback`
- use `confidenceLevel` as data-quality context only
- avoid interpreting packet facts inside this repo slice
- never request or depend on raw provider payloads

Any recommendation layer must live outside G48 and must keep conclusions separate from evidence.

## Premium Service Consumption

Premium services such as War Room, Commissioner Digest, audit tools, and debugging panels should:

- request evidence packets from library functions
- filter by `evidenceType`, `affectedSurfaces`, league/player/game/matchup IDs, or provider domain
- show freshness/fallback warnings honestly
- use internal debug archive keys only in admin-safe contexts
- avoid showing provider payloads to user-facing UI

## Verification

`__tests__/g48-nfl-redraft-provider-evidence-packets.test.ts` verifies:

- player identity evidence
- media/metadata evidence
- projection evidence
- injury evidence
- news evidence
- ranking/ADP evidence
- schedule/game evidence
- weather evidence
- live stats evidence
- fantasy scoring evidence
- stat correction evidence
- roster/matchup/waiver/trade/draft context evidence
- stale, fallback, missing, error, and rate-limit states
- confidence calculation
- affected surface tagging
- deterministic packet IDs
- no raw provider payload leakage
- no conclusion, recommendation, or reasoning fields

## Remaining G49 Work

G49 can begin real provider service wiring or premium service integration on top of these packets, depending on product priority. It should keep packet generation facts-only and should not mix evidence with generated recommendations.
