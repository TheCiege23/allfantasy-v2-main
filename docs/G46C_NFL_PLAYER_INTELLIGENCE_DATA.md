# G46C NFL Player Intelligence Data

## Scope

G46C adds canonical NFL redraft player intelligence data on top of the G45 provider foundation, the G46A identity layer, and the G46B player media/metadata layer.

This milestone does not call real provider APIs, build projections, build weather, build live scoring, or add Decision OS reasoning. It creates the canonical data contract and wires existing runtime/UI adapters to consume it.

## Canonical Data Flow

Provider payloads must normalize before any runtime or UI display consumes them:

```text
Provider payload
  -> G45 freshness/fallback record
  -> G46C canonical player intelligence
  -> Unified player wire DTO
  -> redraft adapters
  -> existing UI/runtime surfaces
```

React components and display adapters should not consume provider-specific payloads or provider-specific player IDs.

## Supported Fields

The canonical `NflRedraftPlayerIntelligence` snapshot includes:

- projected fantasy points
- season and rest-of-season projected points
- projection range when a provider has floor/ceiling values
- scoring format
- fantasy rank
- positional rank
- ADP
- AllFantasy ADP and sample size when already present
- injury designation
- practice status
- game status
- latest news
- news timestamp
- trend label when already present in existing normalized data
- provider freshness metadata
- provider fallback metadata

Missing values stay null or unavailable. G46C does not invent projections, injuries, rankings, ADP, news, game status, or practice status.

## Freshness And Fallback Behavior

The provider normalizer uses G45 freshness helpers:

- fresh provider records map to `available`
- stale provider records carry stale warnings
- missing provider timestamps or fields remain honest as `missing` or `unknown`
- fallback records carry explicit fallback fields and labels

Serialized intelligence excludes raw provider payloads and provider-specific player IDs.

## Surfaces Wired

Canonical intelligence is available to the existing player display path for:

- Draft Room
- Mock Draft rows
- Roster
- Waiver Wire
- Trade Center
- Matchups
- Team/player display records
- Player-card display records

The adapters still preserve legacy scalar fallbacks so existing callers continue to work while canonical intelligence becomes the preferred source.

## Provider Extension Guidance

Future providers should add normalization at the adapter boundary only:

1. Fetch or load a provider record through the G45 provider foundation.
2. Normalize provider fields with `normalizeNflRedraftProviderPlayerIntelligence`.
3. Wrap cache-aware data with `toCanonicalNflRedraftPlayerIntelligenceRecord` when storing or passing provider records.
4. Pass only `NflRedraftPlayerIntelligence` into player-data wire rows and display adapters.

Do not add provider payload reads to React components.

## Remaining G47 Work

G47 should connect real schedule, weather, live stats, scoring refresh, stat corrections, kickoff context, and matchup scoring refreshes. G46C intentionally stops at canonical player intelligence data and does not implement live scoring or weather.
