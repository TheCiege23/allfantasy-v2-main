# G49I Provider Validation Dashboard

## Purpose

G49I adds an internal/admin-only validation surface for AF NFL Redraft provider operations.

The dashboard proves the intended production flow:

Provider -> G49H Orchestrator -> Canonical Models -> G48 Evidence -> Runtime/Premium Services -> UI

It does not build Decision OS, AI reasoning, recommendations, workflow automation, or a customer-facing redesign.

## Dashboard Route

The internal route is:

`GET /api/admin/redraft/provider-validation`

It is protected by the existing `requireAdminOrBearer` boundary, matching other internal production-health routes.

Optional query params:

- `leagueId`
- `teamId`
- `managerId`
- `matchupId`
- `playerId`
- `gameId`
- `week`
- `season`
- `serviceId`

When `leagueId` is supplied, the route loads production canonical evidence through `loadNflRedraftPremiumProductionEvidence`. Without a league context, it returns provider policy/configuration health and the legacy bypass audit without fetching providers.

## Dashboard Fields

The dashboard includes:

- provider display name
- provider status
- enabled/disabled/expired/degraded state
- supported capabilities
- last successful sync timestamp
- last failed sync timestamp
- fallback policy count
- stale evidence count
- missing evidence count
- fallback evidence count
- cache usage count
- fallback selection count
- orchestrator trace metadata
- evidence counts by provider and surface
- legacy direct provider audit entries

The provider rows cover:

- Rolling Insights
- API-Sports
- TheSportsDB
- FantasyCalc
- ClearSports
- OpenWeather
- Sleeper
- ESPN

## Trace Flow

The trace utility lives in:

`lib/nfl-provider/nflRedraftProviderValidationDashboard.ts`

Given a canonical `playerId` or `gameId`, it returns:

- canonical ID
- provider used
- source timestamp
- freshness status
- fallback used
- cache used
- health state
- evidence packet IDs
- affected surfaces
- canonical field names included

The trace view never returns raw provider payloads, provider secrets, API keys, bearer values, or provider-specific UI payloads.

## Legacy Direct Provider Audit

G49I searched for direct provider imports and call sites across `app`, `lib`, `server`, `components`, and `hooks`.

Focused redraft routes under `app/api/redraft/*` did not show direct provider imports in this pass.

Known bypasses documented by the dashboard helper:

| Route/File | Provider | Risk | Migrate Now | Suggested Replacement |
| --- | --- | --- | --- | --- |
| `app/api/cron/import-scores/route.ts` | API-Sports | Medium | No | G49H `live_stats` resolver or canonical cache sync job |
| `app/api/cron/import-schedules/route.ts` | API-Sports | Medium | No | G49H `schedule` resolver and canonical cache handoff |
| `app/api/cron/import-standings/route.ts` | API-Sports | Medium | No | G49H `standings` resolver with runtime fallback |
| `app/api/cron/import-injuries/route.ts` | API-Sports | Medium | No | G49H canonical player intelligence cache path |
| `app/api/sports/sync/route.ts` | API-Sports, ClearSports | Medium | No | Provider adapters that feed the G49H canonical cache path |
| `app/api/sports/weather/route.ts` | OpenWeather | Low | No | G49H `weather` resolver with hidden optional fallback |
| `lib/player-assets/resolvePlayerHeadshot.ts` | API-Sports, ClearSports | High | Yes | G49H `headshots` resolver and canonical metadata/media path |
| `app/api/fantasycalc/route.ts` | FantasyCalc | Medium | No | G49H `fantasy_valuations` resolver with canonical cache before hidden fallback |
| `app/api/redraft/*` | None found | Low | No | Keep new redraft provider-backed work behind G49H |

## Migration Plan

G49J should start with the smallest high-value migration:

1. Move player headshot resolution behind the G49H `headshots` resolver.
2. Keep default avatar fallback visible and honest.
3. Move redraft-facing valuation consumers behind `fantasy_valuations`.
4. Convert cron/import jobs into sync jobs that write canonical cache records rather than returning provider payloads to runtime callers.
5. Add operational alerts for enhancement provider expiration, stale evidence growth, and fallback spikes.

## Safety Boundary

The dashboard is internal/admin-only and read-only.

It does not:

- call LLMs
- produce recommendations
- expose raw provider payloads
- expose provider secrets
- expose provider-specific IDs to customer UI
- mutate provider cache
- run sync/backfill jobs

## Remaining G49J Work

- Migrate direct media lookup to the G49H resolver.
- Add persisted provider trace history if storage patterns are ready.
- Connect cron/import jobs to canonical provider cache writes.
- Add browser/admin page rendering if the JSON route is promoted to a visual admin dashboard.
- Add alert thresholds for fallback count, stale count, missing count, and enhancement provider expiration.
