# G45 NFL Redraft Provider Integration Foundation

## Scope

G45 establishes the NFL redraft provider adapter foundation only. It does not wire provider feeds into draft, mock draft, roster, waiver, trade, matchup, scoring, or OS surfaces yet.

The core rule is that UI surfaces consume AllFantasy canonical data only. Provider payloads must be normalized into internal records before later G46/G47 surfaces read them.

## Provider Strategy

Primary paid/provider-backed path:

- SportsDataIO for live scores, player stats, projections, injuries, news, schedule, headshots, and depth chart style context when licensed.
- OpenWeather for stadium/city weather context.

Secondary/free fallback path:

- Sleeper for read-only NFL player metadata, user/league/draft style context, and mock draft fallback context.
- TheSportsDB for team/event/logo style fallback data where free or configured.
- Deterministic internal fixtures for tests and explicit fallback-only states.

## Foundation Added

`lib/nfl-provider/nflRedraftProviderFoundation.ts` adds:

- provider IDs and data domains;
- provider capability matrix;
- provider env-key validation with no secret exposure;
- fallback-chain resolution per domain;
- provider health report generation;
- stale/fresh/missing freshness detection;
- canonical provider record wrapper;
- provider error normalization;
- retry/rate-limit policy metadata;
- adapter interface for later real clients.

`lib/nfl-provider/index.ts` exports the foundation for later G46/G47/G48 work.

## Capability Matrix

The matrix covers:

- player metadata;
- mock draft context;
- headshots;
- team logos;
- historical stats;
- live scores;
- projections;
- injuries;
- news;
- schedule;
- weather;
- depth chart / role context.

Each capability records provider, priority, API-key requirement, freshness max age, and a short operating note.

## Env Validation

Validated env aliases:

- SportsDataIO: `SPORTSDATAIO_API_KEY`, `SPORTSDATA_API_KEY`, `SPORTS_DATA_IO_API_KEY`
- OpenWeather: `OPENWEATHER_API_KEY`, `OPENWEATHERMAP_API_KEY`, `OPEN_WEATHER_API_KEY`
- TheSportsDB: `THESPORTSDB_API_KEY`, `SPORTSDB_API_KEY`, `THE_SPORTS_DB_API_KEY`
- Sleeper: no key required
- deterministic fixtures: no key required

Validation reports only key names and configured/missing status. It never returns secret values.

## Health Checks

G45 health checks are static and safe: they do not call external providers. The report identifies:

- available providers;
- missing configuration;
- fallback-only deterministic support;
- fallback chain by data domain;
- launch blockers for missing primary live scoring, projection, injury, and weather providers.

Network health checks should be added later behind admin-only routes with rate-limit protection.

## Fallback Chain

Fallback resolution filters unavailable API-key providers out of each domain chain while keeping free/read-only and deterministic providers available. Examples:

- `live_score`: SportsDataIO when configured, deterministic last.
- `player_metadata`: Sleeper first, deterministic last.
- `weather`: OpenWeather when configured, deterministic last.

Deterministic data must remain explicit fallback/test data and must not be presented as current provider truth.

## Stale Data Detection

Canonical provider records carry:

- provider ID;
- provider record ID;
- fetch timestamp;
- source update timestamp;
- freshness status;
- fallback flag;
- warnings.

Freshness is computed by comparing source update time to each domain's max-age policy.

## Error Handling And Rate Limits

Provider errors normalize into:

- `rate_limited`
- `invalid_credentials`
- `forbidden`
- `provider_error`
- `timeout`
- `network_error`
- `unknown`

Retryable errors include retry-after metadata. Credentials and forbidden errors are not retryable.

Rate-limit metadata is conservative and intended for future real clients. G45 does not make external calls.

## Audit Status

- Sports API: provider strategy defined, SportsDataIO primary, Sleeper/TheSportsDB fallback, deterministic last resort.
- Weather API: OpenWeather env and freshness contract defined.
- News API: SportsDataIO primary contract defined.
- Injury API: SportsDataIO primary contract defined.
- Projection API: SportsDataIO primary contract defined.
- Headshot/logo source: SportsDataIO headshots, TheSportsDB team logos fallback.
- Historical stats source: SportsDataIO primary contract defined.
- Live scoring source: SportsDataIO primary contract defined.
- Mock draft source: Sleeper/free metadata and existing deterministic fixtures for fallback.
- AI/OS hooks: adapter output is canonical and source-stamped, but no AI reasoning or OS build is included.

## References

- Sleeper API docs: https://docs.sleeper.com/
- TheSportsDB API docs: https://www.thesportsdb.com/api.php
- OpenWeather API docs: https://openweathermap.org/api
- SportsDataIO NFL API docs: https://sportsdata.io/developers/api-documentation/nfl

## Verification

`__tests__/g45-nfl-redraft-provider-foundation.test.ts` verifies:

- env validation without secret leakage;
- fallback chain ordering;
- launch blocker reporting;
- freshness and canonical provider records;
- provider error normalization and retry decisions.

## Next Milestone Boundary

G46 should wire player, media, injury, news, and projection feeds into redraft surfaces using these contracts. G47 should wire real schedule, weather, live stats, scoring refresh, and standings refresh. G48 should expose provider evidence packets for external OS consumption without building OS reasoning in this repo slice.
