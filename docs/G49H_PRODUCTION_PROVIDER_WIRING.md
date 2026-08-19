# G49H Production Provider Wiring

## Purpose

G49H connects the G49G NFL Redraft provider orchestrator to existing production provider integrations while preserving the canonical-only boundary.

The engineering rule is explicit: no AllFantasy feature should require a month-to-month provider to function. Rolling Insights is the operational backbone. API-Sports, TheSportsDB, FantasyCalc, OpenWeather, and ClearSports are enhancement providers that may enrich data when available, but their failure must not break leagues, premium services, or future OS consumers.

## Providers Discovered

- Rolling Insights: imported/cache-backed backbone plus live/schedule wrappers in `lib/sports-live-scores-service.ts` and field maps in `lib/providers/rollingInsightsNflFieldMap.ts`.
- API-Sports: existing client, diagnostics, sync helpers, schedule, standings, injuries, players, games, and stats functions in `lib/api-sports.ts`.
- TheSportsDB: existing URL builders and field-map/media extractors in `lib/providers/theSportsDbUrls.ts` and `lib/providers/theSportsDbFieldMaps.ts`.
- FantasyCalc: existing valuation client and DB-first cache wrapper in `lib/fantasycalc.ts` and `lib/fantasycalc-db.ts`.
- ClearSports: existing normalized client in `lib/clear-sports/index.ts`.
- OpenWeather: existing stadium/weather helpers in `lib/openweathermap.ts` and weather services under `lib/weather/`.
- Sleeper: existing league import client in `lib/sleeper-client.ts`.
- ESPN: existing league import client in `lib/espn-client.ts`.
- Canonical Cache: existing `SportsDataCache` storage.

## Existing Wrappers Reused

G49H adds `lib/nfl-provider/nflRedraftProductionProviderWiring.ts` as the orchestrator-facing entry point. It does not duplicate provider clients.

The default adapters call existing wrappers lazily:

- Rolling schedule/live: `fetchRollingInsightsScheduleSeason`, `fetchRollingInsightsScoreboard`
- Rolling identity/media fallback: `SportsPlayer` rows with `source = rolling_insights`
- API-Sports: `fetchAPISportsPlayerBySearch`, `fetchAPISportsGames`, `fetchAPISportsGamesByWeek`, `fetchAPISportsStandings`
- TheSportsDB: existing URL builders plus field-map extractors
- FantasyCalc: `getFantasyCalcValuesDbFirst`
- ClearSports: `fetchClearSportsPlayers`, `fetchClearSportsGames`
- OpenWeather: `fetchGameWeather`
- Sleeper: `getLeagueInfo`, `getLeagueRosters`, `getLeagueUsers`
- ESPN: `fetchEspnLeague`

## Capabilities Connected

- Player Identity: Rolling Insights, API-Sports, ClearSports, Canonical Cache
- Schedule/Game Context: Rolling Insights, API-Sports, ClearSports, Canonical Cache
- Live Stats: Rolling Insights, Canonical Cache, Runtime
- Standings: API-Sports, Canonical Cache, Runtime, with Rolling retained as policy backbone
- Headshots: TheSportsDB, API-Sports policy slot, Rolling policy slot, Default Avatar
- Team Logos: TheSportsDB, API-Sports policy slot, Rolling policy slot, AF Default Logo
- Fantasy Valuations: FantasyCalc, Canonical Cache, Hidden optional field
- Weather: OpenWeather, Canonical Cache, Hidden optional field
- League Import: Sleeper, ESPN

## Capabilities Intentionally Deferred

- API-Sports news has diagnostics and sync helpers but no dedicated reusable news client in the inspected code path; G49H keeps it optional and cache/hide fallback remains authoritative.
- Rolling Insights direct REST clients for every documented endpoint were not duplicated. Existing DB/cache imports and live/schedule wrappers are reused.
- ClearSports validation/completeness is used only where policy allows; it is not promoted above Rolling.
- FantasyCalc is valuation-only and never identity.
- TheSportsDB is media-only in this milestone.

## Fallback Behavior

The G49H resolver walks the G49G policy chain and executes adapters one at a time. Failed, disabled, or expired providers are skipped. Adapter exceptions are recorded and the chain continues.

Examples:

- FantasyCalc failed -> internal/cache path -> canonical cache -> hidden value
- TheSportsDB failed -> API-Sports/Rolling media slots where available -> default avatar/logo
- API-Sports failed -> Rolling where policy allows -> canonical cache -> hidden optional field
- OpenWeather failed -> canonical cache -> hidden weather context

Runtime-critical domains preserve AllFantasy runtime state rather than breaking.

## Health Behavior

The production config helper marks Rolling Insights active as the backbone. Month-to-month enhancement providers are marked active only when credentials are present, except FantasyCalc which uses the existing DB-first public wrapper.

Missing enhancement credentials produce `EXPIRED` provider state, forcing fallback without turning optional enrichment into a runtime dependency.

## Traceability Flow

Internal trace metadata is available from the resolver:

Canonical Player
-> Provider Used
-> Timestamp
-> Freshness
-> Fallback Used
-> Cache Used
-> Health Status

This is intended for internal diagnostics only. Customer UI and premium/OS consumers receive canonical models, not raw provider payloads.

## Canonical Boundary

Provider adapter results are sanitized before they leave the resolver. Raw provider payloads, provider-specific IDs, secrets, and API key fields are blocked from canonical output.

The resolver returns:

- canonical data
- selected provider metadata
- fallback attempts
- trace metadata
- warnings
- conflict metadata

It never returns raw provider payloads by default.

## Known Limitations

This milestone establishes the production provider entry point and default adapters. Some existing legacy routes may still call providers directly and should be migrated to `resolveNflRedraftProductionProviderCapability` during G49I/G50 launch hardening.

Browser verification was not expanded in this milestone because the task focused on provider wiring behind the orchestrator and no UI rewrite was requested.

## Remaining G49I Work

- Migrate remaining NFL Redraft routes/runtime services to the production resolver.
- Add admin diagnostics around provider attempt traces.
- Expand live stats/stat-correction provider adapters where production feeds are available.
- Complete API-Sports news adapter if/when a dedicated reusable news wrapper is added.
- Add launch alerts for enhancement provider expiration and fallback volume.
