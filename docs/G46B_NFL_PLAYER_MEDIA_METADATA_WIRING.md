# G46B NFL Player Media Metadata Wiring

## Scope

G46B wires normalized NFL redraft player media and metadata into existing runtime/display adapters. It does not build Decision OS, projections, live scoring, weather, or direct provider API calls.

The implementation builds on:

- G45 provider foundation for freshness/fallback concepts.
- G46A canonical player identity mapping for provider-to-canonical normalization.
- G41 canonical NFL redraft player snapshots for existing runtime rows.

## What Was Wired

Created `NflRedraftPlayerDisplayMetadata` in `lib/player-data/nflRedraftPlayerMetadata.ts`.

The display-safe metadata includes:

- player display name
- team abbreviation
- position
- fantasy positions
- jersey number
- headshot URL
- honest headshot fallback metadata
- team logo URL
- honest logo fallback metadata
- bye week
- active status
- provider freshness metadata
- provider fallback status

The metadata object intentionally excludes provider-specific player IDs and raw provider payloads.

## Canonical Data Flow

```text
Provider payload
  -> G46A canonical identity
  -> G46B display-safe metadata
  -> runtime/UI adapters
  -> existing components
```

Existing G41 canonical rows also project into the same metadata shape:

```text
Unified player product view
  -> G41 NFL redraft canonical player
  -> G46B display-safe metadata
  -> draft / roster / waiver / trade / matchup / player-card adapters
```

## Supported Surfaces

G46B wires metadata through existing adapter/component paths for:

- Draft Room
- Mock Draft rows, through the same draft pool row adapter
- Roster
- Waiver Wire
- Trade Center evidence slices
- Matchup player cards
- Team Page display maps
- Player Cards using redraft display records

The draft room card and dense Sleeper-style draft table now prefer `canonicalPlayerMetadata` for display name, team, position, headshot, logo, and bye week.

## Fallback Behavior

Headshots:

- Valid `http(s)` headshots render normally.
- Missing or invalid headshots do not receive fake image URLs.
- Components receive fallback metadata such as player initials and fallback reason.

Team logos:

- Valid `http(s)` team logos render normally.
- Missing logos use text-badge metadata based on the normalized team abbreviation.
- No fake logo URLs are generated.

Provider freshness:

- Fresh, stale, missing, and unknown states are represented in `providerFreshness`.
- Stale warnings from canonical rows are carried forward.
- G46A stale provider identity records are projected into stale display metadata.

Provider fallback:

- Missing or fallback-derived fields are listed in `providerFallback`.
- Surfaces can display minimal warnings now and richer messaging later without parsing provider payloads.

## Guardrails

- React/display adapters consume `NflRedraftPlayerDisplayMetadata`.
- Provider payloads are not passed to components.
- Provider-specific player IDs are not included in the display metadata object.
- Existing deep canonical objects remain available for runtime compatibility, but display wiring now has a safer metadata contract.

## Verification

Regression tests cover:

- canonical metadata creation
- fallback headshot behavior
- fallback logo behavior
- missing provider fields
- stale provider record handling
- draft/roster/waiver/trade/matchup/team/player-card adapter consumption
- no provider payload or provider-ID leakage into the display metadata

## Remaining Work For G46C

G46C should wire real provider-backed injury, news, and projection feeds into this canonical metadata/data pipeline. It should continue to keep provider payloads behind adapters and should not expose provider-specific objects directly to UI components.
