# G49J Provider Certification

## Purpose

G49J migrates the safest remaining NFL Redraft provider bypasses behind the G49G/G49H provider orchestration path and certifies that provider-backed data follows the canonical AllFantasy flow.

Required flow:

Provider -> Orchestrator -> Canonical Model -> Evidence -> Runtime -> UI

This milestone does not build Decision OS, Commissioner OS, Manager OS, LLM reasoning, recommendations, or a runtime redesign.

## Completed Migrations

### NFL Player Headshots

Migrated:

`lib/player-assets/resolvePlayerHeadshot.ts`

NFL headshot resolution now calls:

`resolveNflRedraftCanonicalHeadshot`

That helper calls the G49H production provider resolver for the `headshots` capability. NFL media now flows through the canonical provider policy and returns default fallback state honestly when media is unavailable.

The legacy non-NFL ClearSports/TheSportsDB fallback path is intentionally left intact because G49J is scoped to NFL Redraft.

### Team Weather Route

Migrated:

`app/api/sports/weather/route.ts?team=`

Team-based NFL weather now calls:

`resolveNflRedraftCanonicalWeather`

The route returns canonical metadata including provider, freshness, cache usage, fallback usage, and unavailable state. Weather remains context only and does not affect scoring.

Lat/lon, city, and forecast utility modes remain on the existing weather service because those are broader sports utility surfaces, not NFL Redraft runtime-specific paths.

### Single-Player Fantasy Value Lookup

Migrated:

`app/api/fantasycalc/route.ts?action=player`

Single-player valuation now calls:

`resolveNflRedraftCanonicalFantasyValuation`

This routes player valuation through the G49H `fantasy_valuations` capability and returns provider/freshness/fallback/cache metadata.

List, top, trending, directory, and trade comparison response shapes remain deferred to avoid breaking legacy API consumers.

## Remaining Bypasses

Deferred intentionally:

| Route/File | Reason |
| --- | --- |
| `app/api/sports/weather/route.ts` lat/lon/city/forecast modes | Broad utility API, not specifically NFL Redraft runtime. |
| `app/api/fantasycalc/route.ts` list/top/trending/directory/compare | Existing legacy response shapes are broader than G49J and should migrate behind a versioned canonical API. |
| `app/api/cron/import-scores/route.ts` | Pre-existing dirty file and cron architecture should migrate as a grouped canonical cache sync. |
| `app/api/cron/import-schedules/route.ts` | Same cron/cache migration concern. |
| `app/api/cron/import-standings/route.ts` | Same cron/cache migration concern. |
| `app/api/cron/import-injuries/route.ts` | Same cron/cache migration concern. |
| `app/api/sports/sync/route.ts` | Broad admin sync path across providers and sports; should be split into canonical provider sync jobs. |

## Certification Matrix

G49J adds:

`lib/nfl-provider/nflRedraftProviderCertification.ts`

Certified domains:

| Domain | Capability | Certification |
| --- | --- | --- |
| Player Identity | `player_identity` | Provider -> orchestrator -> canonical identity -> evidence -> runtime/UI |
| Player Metadata | `player_identity` | Canonical player metadata remains the UI contract |
| Headshots | `headshots` | NFL media uses canonical resolver and default fallback |
| Logos | `logos` | Canonical logo capability and default text-badge fallback |
| Schedules | `schedule` | G47A canonical game context |
| Weather | `weather` | Canonical weather resolver with hidden/cache fallback |
| Fantasy Values | `fantasy_valuations` | Canonical valuation resolver |
| Evidence Packets | canonical evidence | G48 facts-only packets |
| Premium Services | premium evidence | G49A-F canonical evidence consumers |
| Runtime | `live_stats` | Runtime/cache fallback preserves leagues |

## Outage Behavior

Verified outage expectations:

- FantasyCalc unavailable: valuation falls back to canonical cache, then hidden optional value.
- API-Sports unavailable: enhancement schedule/news/media slots fall back to Rolling, cache, runtime, or hidden/default media.
- TheSportsDB unavailable: media falls back to alternate canonical media providers or default avatar/logo.
- OpenWeather unavailable: weather is hidden or served from canonical cache; runtime continues.
- ClearSports unavailable: enhancement data is skipped; Rolling/cache/default paths remain.
- Rolling unavailable: platform enters degraded mode and preserves cache/runtime behavior where policy allows.

## Fallback Verification

The G49J regression suite verifies:

- canonical media resolution
- default media fallback
- canonical weather resolution
- hidden weather fallback
- canonical fantasy valuation resolution
- route wiring for migrated paths
- certification matrix completeness
- no raw provider payload leakage
- no provider secret leakage
- no AI/recommendation fields

## Browser Validation

No new browser route was required for this milestone. Existing player surfaces already consume `PlayerHeadshot`, and G49J moved the server resolver behind canonical media for NFL. Practical browser validation remains a launch-hardening task once the admin JSON dashboard is promoted into a visual admin page or a deterministic seeded league is running.

## Production Readiness Assessment

Provider correctness is materially improved for NFL Redraft:

- highest-risk player media bypass is now canonical for NFL
- team weather route is canonical for NFL team mode
- single-player valuation lookup is canonical
- provider outage behavior is certified in tests
- remaining bypasses are known and intentionally deferred

This is not a claim that every legacy provider route in the full app is migrated. It certifies the NFL Redraft provider path and documents the remaining launch blockers.

## Remaining Launch Blockers

- Migrate cron/import jobs into canonical cache sync jobs.
- Version or replace legacy FantasyCalc list/trending/compare APIs.
- Move broad sports sync paths behind provider adapter jobs.
- Add persisted provider trace history if storage patterns are ready.
- Add browser/admin visual proof for the provider validation dashboard.
- Add alert thresholds for fallback spikes, stale evidence growth, and enhancement provider expiration.
