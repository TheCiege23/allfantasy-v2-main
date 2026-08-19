# G46A NFL Player Identity Mapping

## Scope

G46A creates the canonical player identity layer for the AF NFL Redraft League. It does not wire provider data into UI surfaces, projections, weather, live scoring, or Decision OS flows.

The identity layer keeps provider-specific payloads behind adapter utilities. Runtime and future UI code should consume only canonical AllFantasy player identity models.

## Architecture

The implementation lives in `lib/nfl-provider/nflRedraftPlayerIdentity.ts` and builds on the G45 provider foundation:

1. A provider payload enters a provider-specific normalizer.
2. The normalizer extracts only documented identity fields.
3. Shared mapping utilities normalize IDs, teams, positions, fantasy positions, headshots, and logos.
4. The result is a `NflRedraftCanonicalPlayerIdentity`.
5. Cache-aware helpers attach G45 freshness metadata and stale/fallback warnings.

Provider payloads are never returned on the canonical object.

## Mapping Flow

```text
Provider player payload
  -> provider adapter field candidates
  -> shared ID/team/position/media normalizers
  -> canonical AllFantasy player identity
  -> optional G45 canonical provider record wrapper
```

Supported entry points:

- `normalizeRollingInsightsPlayerIdentity`
- `normalizeSportsDataIoPlayerIdentity`
- `normalizeSleeperPlayerIdentity`
- `normalizeTheSportsDbPlayerIdentity`
- `normalizeNflRedraftProviderPlayerIdentity`
- `toCanonicalNflRedraftPlayerIdentityRecord`

## Supported Providers

- Rolling Insights: primary imported identity/profile source when configured.
- SportsDataIO: licensed identity, media, team, and status fields.
- Sleeper: free read-only player metadata fallback.
- TheSportsDB: public player/team identity and media fallback where available.
- Deterministic: last-resort internal fixtures for tests and degraded environments.

Rolling Insights was added to the G45 provider foundation as an additive provider ID and `player_metadata` capability. When not configured, the G45 fallback chain still resolves to Sleeper and deterministic fixtures.

## Canonical Schema

`NflRedraftCanonicalPlayerIdentity` includes:

- `allFantasyPlayerId`
- `providerIds`
- `playerName`
- `preferredDisplayName`
- `team`
- `providerTeamIds`
- `position`
- `fantasyPositions`
- `jerseyNumber`
- `headshotUrl`
- `teamLogoUrl`
- `height`
- `weight`
- `age`
- `experience`
- `college`
- `byeWeek`
- `activeStatus`
- `sourceProviderId`
- `cache`

The cache metadata includes provider timestamp, fetch timestamp, last successful sync, G45 freshness status, stale flag, fallback flag, and normalization warnings.

## Extension Guidance

To add a future provider:

1. Add the provider to the G45 provider foundation only if it participates in the provider capability/fallback chain.
2. Add a provider entry to `NFL_REDRAFT_PLAYER_IDENTITY_PROVIDERS`.
3. Define field candidates in `PROVIDER_FIELD_CANDIDATES`.
4. Add a thin provider-specific normalizer that calls `normalizeNflRedraftProviderPlayerIdentity`.
5. Add tests for complete payloads, partial payloads, ID crosswalks, stale timestamps, and no raw payload leakage.

Runtime components should not be changed when adding a provider. They should keep reading canonical AllFantasy player identity fields.

## Verified Behavior

The G46A test suite verifies:

- SportsDataIO full identity normalization.
- Sleeper partial payload fallback behavior.
- TheSportsDB full-team-name and media mapping.
- Rolling Insights ID mapping and stale cache detection.
- G45 canonical provider record wrapping.
- Reusable ID, team, position, fantasy-position, headshot, and fallback-chain utilities.

## Remaining Work For G46B

G46B should consume this identity layer to wire provider-backed player media, injury, news, and projection feeds into draft, mock draft, roster, waivers, trades, matchups, and live-scoring metadata. G46B should not bypass this identity layer or expose provider-specific payloads to UI components.
