# G47A NFL Schedule Weather Context

## Scope

G47A adds canonical NFL redraft game context for schedule, opponent, stadium, and weather data.

This milestone does not build live scoring, stat corrections, Decision OS, AI reasoning, or new external infrastructure. It creates the canonical context layer that G47B can use when real schedule/weather providers are connected.

## Canonical Data Flow

```text
Provider payload
  -> G45 freshness/fallback record
  -> canonical NFL redraft game context
  -> unified player wire DTO
  -> redraft adapters
  -> existing runtime/UI surfaces
```

React components and runtime display helpers must consume `NflRedraftGameContext`, not provider payloads or provider-specific IDs.

## Supported Fields

The canonical context supports:

- NFL season
- NFL week
- opponent
- home/away
- kickoff timestamp
- game date
- stadium name
- stadium city/state
- roof context: dome, retractable, outdoor, or unknown
- bye week
- bye-week state
- game status
- weather condition
- temperature
- wind speed
- precipitation/rain/snow indicator
- weather freshness
- provider freshness
- provider fallback status

Unavailable schedule or weather values remain null/unavailable with fallback fields. G47A does not invent schedules, opponents, stadiums, kickoff times, weather, or game status.

## Provider Extension Guidance

Future schedule/weather adapters should:

1. Fetch or load provider records through the G45 provider foundation.
2. Normalize provider records with `normalizeNflRedraftProviderGameContext`.
3. Wrap cache-aware provider data with `toCanonicalNflRedraftGameContextRecord`.
4. Pass only `NflRedraftGameContext` into player-data wire rows and display adapters.

Provider-specific payloads should stay at adapter boundaries.

## Fallback Behavior

Fallback metadata lists missing schedule domains such as:

- `season`
- `week`
- `opponent`
- `kickoffTime`
- `stadium`
- `roofType`
- `weather`

Bye weeks are treated explicitly. If the requested week equals a player/team bye week, the context marks `isByeWeek`, uses `gameStatus: "Bye"`, and does not claim opponent, stadium, kickoff, or weather data.

## Freshness Behavior

G47A uses G45 freshness helpers:

- schedule context defaults to schedule-style freshness
- weather context uses a shorter freshness window
- stale provider records carry warnings
- missing provider timestamps remain `missing` or `unknown`
- fallback records carry explicit fallback fields and labels

## Surfaces Wired

Canonical game context is available to:

- Draft Room
- Mock Draft rows
- Roster
- Waiver Wire
- Trade Center
- Matchups
- Team/player display records
- Player-card display records

Existing scalar fields remain as compatibility fallbacks, but canonical game context is preferred when present.

## Remaining G47B Work

G47B should connect real provider-backed NFL schedule, weather, live stats, scoring refresh, stat corrections, kickoff windows, matchup scoring refresh, and standings refresh. G47A intentionally stops at canonical schedule/weather context and does not implement live scoring.
