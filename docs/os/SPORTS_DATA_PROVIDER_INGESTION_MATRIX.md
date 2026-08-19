# Provider Ingestion Matrix (Phase 5H Audit)

Source-of-truth audit of every configured provider. A provider is **VERIFIED** only after a real request succeeds → schema validates → normalization succeeds → canonical persistence succeeds → certified retrieval succeeds → idempotent rerun proven → no raw leak into product runtime. Credential presence alone ≠ verified.

## Legend
`AUDITED` inspected · `IMPLEMENTED` adapter/normalizer exists · `VERIFIED` real request+schema proven · `CERTIFIED` writes canonical certified snapshots consumed by runtime · `BLOCKED` credential/capability gap · `REQ-MIGRATION` needs schema change · `REQ-NORMALIZE` needs canonical normalizer · `REQ-WIRING` needs runtime port/consumer.

## Certified plane providers (gateway → `sports_data` schema)
| Provider | Status | Verified capabilities | Adapter | Certified? | Notes |
|---|---|---|---|---|---|
| **Sleeper** | production_connected | players + rosters + transactions + draft + espn_id crosswalk (ALL via adapter) | `providers/sleeper.ts` (fetchers) + `runtime/{roster,transaction,draft}Runtime.ts` (normalize) | ✅ CERTIFIED | **Phase 5H-b: adapter purity ACHIEVED** — roster/txn/draft fetchers moved INTO `providers/sleeper.ts`; runtime modules hold zero provider URLs |
| **ESPN** | partial→verified | schedules, games, box-score statistics, team identity | `providers/espn.ts` | ✅ CERTIFIED | athlete ids need identity map; undocumented rate limits |
| **FantasyCalc** | verified | identity crosswalk (sleeperId+espnId), player values | `providers/fantasycalc.ts` (identity only) | ✅ CERTIFIED (identity) | values VERIFIED (5H-c live proving: real records → governed `canonicalValue.ts` contract, boundary-separated) but VALUE egress still lives in `lib/fantasycalc.ts`/`fantasycalc-db.ts` (NOT `providers/`); a real gateway value adapter + certified `PlayerValue` table are REQ-WIRING/REQ-MIGRATION |

## Phase 5H-d live certification (real requests, 2026-07-13, non-prod) — see `SPORTS_DATA_PROVIDER_CERTIFICATION_5HD.md`
Credential presence alone is never "connected". Real-request verdicts:
- **CERTIFIED (re-affirmed, keyless, end-to-end canonical):** ESPN (16 games + box score), Sleeper (12,200 players + 6,736 crosswalk), FantasyCalc (463 values → boundary-separated CanonicalPlayerValue).
- **VERIFIED (keyed, real request + canonical route; persistence REQ-MIGRATION):** TheSportsDB (real headshot → CanonicalImageReference), CFBD (133 NCAAF roster rows → canonicalPosition, detail preserved), API-Sports (20 EPL soccer teams; soccer outside NFL/NCAAF canonical scope → REQ-NORMALIZE).
- **BLOCKED:** ClearSports (`api-keys/me` HTTP 500, provider-side).
- **REQUIRES_WIRING:** Rolling Insights (client DB-coupled; needs a dedicated `providers/rolling-insights.ts` adapter to probe).
Certified `sports_data` snapshots are fed by **ESPN + Sleeper only**; RI/API-Sports/ClearSports/CFBD/TheSportsDB write legacy Prisma tables (not the certified plane) and have **no gateway adapter yet**. Code source of truth: `lib/sports-data-gateway/providers/certificationStatus.ts` (test-locked).

## Configured-but-unverified providers (legacy direct clients; NOT on the certified plane)
| Provider | Status | Declared capabilities | Legacy client | Certified? | Gap |
|---|---|---|---|---|---|
| **Rolling Insights** | configured_not_verified | players, teams, schedules, games, live_scores, statistics, injuries, depth_charts | `lib/upstream-apis.ts`, `lib/players/ri-players-server.ts` | ❌ | BLOCKED (no verified request) → then REQ-NORMALIZE + REQ-WIRING |
| **CFBD** (college FB) | configured_not_verified | college_players, teams, schedules, games, statistics | `lib/cfb-player-data.ts` | ❌ | BLOCKED → REQ-NORMALIZE; must isolate NCAAF from NFL pool |
| **TheSportsDB** | configured_not_verified | players, teams, team_branding, player_headshots | (scattered) | ❌ | BLOCKED → identity/imagery source; REQ-NORMALIZE |
| **API-Sports** | configured_not_verified | players, teams, games, live_scores, statistics | `lib/api-football.ts` | ❌ | BLOCKED; per-sport/product adapters needed → REQ-NORMALIZE |
| **ClearSports** | configured_not_verified | players, statistics | (none found) | ❌ | BLOCKED (capabilities unproven) |
| **OpenWeatherMap** | configured_not_verified | weather | `lib/upstream-apis.ts` | ❌ | out of core scope |
| **NewsAPI** | configured_not_verified | news | (scattered) | ❌ | out of core scope |

## Import-only providers (customer-authorized league context, NOT sports-data)
| Provider | Role | Notes |
|---|---|---|
| **Yahoo** | league import (OAuth) | league_data/rosters/transactions; no sports-data crosswalk |
| **MFL** | league import | mflId identity column exists; no ESPN crosswalk |
| **Fantrax** | league import | `lib/fantrax-parser.ts`; no crosswalk |
| **Fleaflicker** | league import | fleaflickerId column; no crosswalk |

## Honest summary
- **CERTIFIED & consumed:** ESPN, Sleeper, FantasyCalc (3).
- **Configured-but-UNVERIFIED (must not be presented as connected):** Rolling Insights, CFBD, TheSportsDB, API-Sports, ClearSports, OpenWeatherMap, NewsAPI (7).
- **Import-only (out of sports-data scope):** Yahoo, MFL, Fantrax, Fleaflicker (4).
- **Legacy direct-client modules exist** for RI/API-Sports/CFBD/ESPN/Sleeper and populate legacy Prisma tables — these are the current *production* inputs and run in parallel to the certified plane. Routing them through canonical certified persistence is REQ-WIRING/REQ-NORMALIZE (multi-increment).
