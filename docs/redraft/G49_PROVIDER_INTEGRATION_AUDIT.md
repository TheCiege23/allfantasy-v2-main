# G49 Real Provider Integration Audit

Date: 2026-07-12

## Final Decision

```text
G49 PROVIDER AUDIT: FAIL
READY FOR LIVE PROVIDER CERTIFICATION: NO
```

The canonical NFL provider foundation is substantially wired and its focused contract suites pass. The audit does not certify live credentials, current provider payloads, authenticated rendering, provider-to-cache freshness, or production behavior. Remaining direct ingestion bypasses and the missing canonical injury capability make a truthful readiness decision **NO**.

## Scope and Evidence Boundary

This was a source and contract-test audit. No provider was called, no fixture response was counted as live evidence, no authenticated session was used, and no database, cache, league, Trade OS, Renewal, Prisma, or environment state was changed.

Classifications used:

- **Live provider**: a production adapter exists and can call an external provider when configured.
- **Cached provider**: the customer path reads normalized database/cache state populated by ingestion.
- **Fixture**: deterministic/test-only data; never counted as production evidence.
- **Stub**: intentional unavailable/default/hidden behavior or an unimplemented adapter slot.
- **Dead code**: no reachable NFL Redraft consumer was found in the focused audit.
- **Awaiting certification**: source wiring exists but live credentials/runtime evidence were not exercised.

## Architecture Verified

The intended path exists:

```text
Provider -> NFL provider orchestrator -> canonical model/cache -> redraft runtime/API -> customer UI
```

`lib/nfl-provider/nflRedraftProviderOrchestrator.ts` defines policy and fallback chains. `lib/nfl-provider/nflRedraftProductionProviderWiring.ts` adapts existing provider clients. Runtime-critical paths preserve cached or native runtime state when providers fail, while optional media/context fields degrade to defaults or hidden state.

Provider payloads are sanitized at the orchestration boundary. The resolver exposes canonical data and internal trace metadata rather than raw provider payloads or secrets.

## Provider Inventory

| Provider | NFL role | Integration state | Cache/fallback | Certification status |
| --- | --- | --- | --- | --- |
| Rolling Insights | Preferred identity, schedule, live-stat backbone; policy slot for media | Live adapters plus imported DB/cache wrappers | Canonical cache; native runtime for live stats | Awaiting live credential/data certification |
| API-Sports | Secondary identity/schedule/standings; optional news/media slot; legacy ingestion | Live clients exist; several cron jobs still call them directly | Canonical cache/runtime where orchestrated | Partial; direct ingestion bypasses remain |
| TheSportsDB | Preferred headshots and team logos | Canonical media adapters | Default avatar or text-badge logo | Source-certified; live media not certified |
| FantasyCalc | Redraft valuation/ADP enrichment | DB-first/public wrapper behind canonical valuation resolver for single-player lookup | Canonical cache, then hidden optional value | Partial; list/top/trending/compare remain legacy |
| OpenWeather | Optional team weather context | Team-mode route is canonical | Canonical cache, then hidden | Source-certified; live weather not certified |
| ClearSports | Tertiary identity/schedule enrichment | Canonical adapters plus broad legacy sync path | Skipped when unavailable; Rolling/cache remain authoritative | Partial |
| Sleeper | League import; player/ADP compatibility paths in legacy and mock-draft code | Live import adapter and existing clients | Import failure is non-load-bearing to native leagues | Source-wired; live import not certified here |
| ESPN | Secondary league import | Live import adapter | No cache fallback in import policy | Source-wired; live import not certified here |
| Canonical `SportsDataCache` | Provider-normalized fallback | Read adapter exists for identity, schedule, live stats, standings, valuation, weather, news | Stale state is labeled; policy decides whether stale data is allowed | Contract-tested, DB freshness unverified |
| Native AllFantasy runtime | League schedule, standings, scores, roster and transaction truth | DB-backed redraft runtimes | Preserves league operation when enrichment is unavailable | Source-wired; authenticated DB validation remains G48 |

## Endpoint and Surface Inventory

### League, Schedule, Standings, and Matchups

| Surface / endpoint | Classification | Provider path | Cache, retry, and failure behavior | UI state |
| --- | --- | --- | --- | --- |
| `GET /api/redraft/season` | Cached/native DB | `RedraftSeason`, rosters, league state; no direct provider call | Request can be retried by refresh | Canonical schedule shows preseason state when no season exists |
| `GET /api/redraft/schedule` | Cached/native DB | `resolveNflRedraftScheduleRuntime`; league matchup schedule, not the external NFL game schedule adapter | No provider call in request path; errors surface to client | Loading, explicit error, preseason empty state, full schedule view |
| `GET /api/redraft/standings` | Cached/native DB | Redraft rosters and finalized matchups | Honest message when no finalized scores exist | Loading/error/empty playoff states exist |
| `GET /api/redraft/live-scoring` | Cached provider + native runtime | `PlayerWeeklyScore` and canonical scoring runtime | Missing player scores remain missing; runtime does not invent them | Matchup UI labels live vs cached and reports missing starter scores |
| `POST/GET /api/redraft/score-sync` | Cached-provider ingestion bridge | Synchronizes cached NFL weekly stats into `PlayerWeeklyScore` | Reports when provider/cache job has not populated weekly data | Not a direct customer provider call |
| `GET /api/leagues/[leagueId]/matchup-center` | Cached/native DB | Matchup center service consumes persisted scores/stat lines/projections | Credentialed fetch, manual refresh, realtime refresh hook, cadence-based polling; request errors are visible | Skeleton/loading and explicit error state |
| External NFL schedule/standings capability | Live provider + cache | Rolling/API-Sports orchestration exists | Adapter exception advances fallback chain | Not directly used as league matchup schedule/standings truth |

Finding: league standings and fantasy schedules are correctly native league data. The launch risk is the ingestion path that supplies weekly player scores, not an absence of league UI wiring.

### Players

| Feature | Classification | Provider / source | Fallback and failure behavior | Gap |
| --- | --- | --- | --- | --- |
| Projections | Cached provider + AllFantasy model | `FantasyProjection`, `AFProjectionSnapshot`, season stats, ADP snapshot, canonical player data | `buildAllFantasyProjection` composes available inputs and exposes source/confidence | Live freshness and provider accuracy unverified |
| Injuries | Cached provider, partial | `SportsInjury`, canonical player/unified player fields; API-Sports injury cron | Existing values fall back through canonical/unified/player status | **No first-class `injuries` orchestrator capability; ingestion still bypasses canonical orchestration** |
| Availability | Cached/native DB | Roster ownership, player status, injury fields | Missing injury data remains unknown rather than fabricated | Authenticated runtime proof pending |
| Depth charts | Cached provider | Prisma `DepthChart`; ingestion job exists | Empty collection when no rows are present | Customer NFL Redraft reachability/freshness not live-certified |
| Headshots | Live provider + default | Canonical headshot resolver: TheSportsDB, API-Sports/Rolling policy slots | Default avatar terminal fallback | Source-certified; live media response unverified |
| Team logos | Live provider + default | Canonical logos capability | AllFantasy text-badge fallback | No focused customer-route live proof |
| Player analytics/game logs | Mixed cached/legacy | Player analytics route and legacy game-log consumers | Component-level loading/error behavior exists | Legacy Sleeper-backed path remains outside the canonical G49 capability boundary |

### Transactions

| Feature | Classification | Provider dependency | Result |
| --- | --- | --- | --- |
| Waiver claims, priority, FAAB, processing | Native DB/runtime | No live provider required; player metadata/projections are cached enrichment | Core transaction path remains operable during provider outage |
| Waiver player list | Cached provider + native DB | Persisted player projections, injuries, availability, roster ownership | Multi-endpoint loading; visible rows expose source/quality labels where available |
| Trades, review, history, roster updates | Native DB/Trade OS | No live provider required; valuations/injury context are optional cached enrichment | Existing Trade OS remains untouched and non-load-bearing on provider availability |
| Single-player fantasy value | Live/cached provider | Canonical FantasyCalc resolver | Cache then hidden optional value | Canonical for single-player only |
| FantasyCalc list/top/trending/compare | Legacy provider path | FantasyCalc legacy response shapes | Existing behavior retained | Needs versioned canonical migration before it can be certified as canonical |

### Live Scoring and Refresh

| Concern | Verified source behavior | Classification |
| --- | --- | --- |
| Live-stat provider | Rolling Insights preferred; canonical cache and native runtime fallbacks | Live provider, awaiting certification |
| Score ingestion | API-Sports score cron still imports directly; redraft score sync consumes cached weekly rows | Partial / legacy bypass |
| Refresh cadence | Matchup center chooses live/upcoming/final cadence and polls silently; realtime league refresh also triggers reload | Fully wired at source level |
| Caching | `SportsDataCache`, `PlayerWeeklyScore`, provider-specific imported tables, and endpoint-level caches exist | Cached provider |
| Missing data | UI labels cached scoring and missing starter scores; runtime preserves fields rather than inventing scores | Truthful degradation |
| Retry | Client polling/manual refresh and orchestrator fallback exist; provider adapter calls do not expose a generalized exponential-retry policy in this audited path | Partial |
| Stat corrections | Runtime has persisted rescore/update paths, but live provider correction behavior was not exercised | Awaiting certification |

### Draft

| Feature / endpoint | Classification | Source and cache | Failure behavior | Gap |
| --- | --- | --- | --- | --- |
| `GET /api/leagues/[leagueId]/draft/pool` | Cached provider + rebuilt DB pool | Authenticated league access; persistent `DraftPoolCache`, in-memory cache, normalized player foundation | DB-cache read failure is non-fatal; cold rebuild; five-minute server cache | Live pool completeness/freshness unverified |
| Rankings | Cached/internal | Normalized player product view and league-aware pool ordering | Falls back to available normalized fields | Provider accuracy unverified |
| AllFantasy AI ADP | Cached/internal snapshot | `AllFantasyAdpSnapshot`; recompute pipeline | Explicit message when snapshot is absent | Snapshot recency unverified |
| External ADP | Mixed live/cached legacy | Fantasy Football Calculator, multi-platform ADP, Sleeper compatibility paths | Cache and normalized fallbacks in draft/mock-draft modules | Not uniformly behind NFL canonical provider orchestrator |
| Player availability | Native DB | Draft session/picks and league roster state | Rebuilt from authoritative draft/roster state | Authenticated concurrency proof pending G48 |
| Injury/projection display | Cached provider | Normalized draft entry metadata and projection source tags | Null/unknown allowed; position-aware projection fallback exists | Live source freshness unverified |

## Fixture Inventory

Fixtures are present in E2E tests, mock-draft engines, deterministic provider definitions, and seeded walkthroughs. The NFL provider registry explicitly marks the deterministic provider disabled and test-only. None were used as evidence that a production provider is live.

Important fixture-backed areas:

- deterministic provider adapters used by orchestration tests;
- seeded redraft trade/waiver/draft walkthroughs;
- mock-draft player pools and simulated managers;
- G46/G47 browser fixtures used for UI behavior, not provider truth.

## Stub and Deferred Inventory

- API-Sports has no dedicated reusable canonical news client; diagnostics/cache/hidden behavior substitutes.
- Injuries have no standalone canonical orchestrator capability.
- Media uses truthful default avatar/logo terminal fallbacks.
- Weather, news, and valuations can be intentionally hidden when unavailable.
- Rolling media policy slots do not prove a complete live media adapter for every path.
- Native runtime fallback for live stats/standings preserves league state but is not provider freshness.
- No focused dead NFL Redraft provider endpoint was proven. Several broad legacy APIs are reachable but outside the canonical redraft boundary.

## Direct Provider Bypasses

The following current files still bypass the canonical NFL resolver as ingestion/sync entry points:

| File | Provider | Risk |
| --- | --- | --- |
| `app/api/cron/import-scores/route.ts` | API-Sports | High for live score freshness/certification |
| `app/api/cron/import-schedules/route.ts` | API-Sports | Medium; external schedule cache only |
| `app/api/cron/import-standings/route.ts` | API-Sports | Medium; must not replace fantasy standings truth |
| `app/api/cron/import-injuries/route.ts` | API-Sports | High because injuries lack canonical orchestration |
| `app/api/sports/sync/route.ts` | API-Sports and ClearSports | Medium; broad admin sync bypass |
| `app/api/fantasycalc/route.ts` non-player actions | FantasyCalc | Medium; legacy response contracts |
| `app/api/sports/weather/route.ts` lat/lon/city/forecast modes | OpenWeather | Low and not redraft-specific |

The current `nflRedraftProviderValidationDashboard` correctly records most of these as known legacy paths, but some older documentation describes cron canonicalization as future work even though a `nflRedraftCronCanonicalSync` helper now exists. The helper is not imported by the four audited cron routes, so the runtime gap remains real.

## Loading, Empty, Retry, and Failure UX

- Canonical Schedule: loading, explicit error, preseason/no-season state.
- Standings/playoffs: loading, explicit runtime error, no-playoff empty state.
- Matchup Center: skeleton, visible error, manual refresh, background cadence refresh, realtime refresh.
- Draft Pool: route errors are surfaced by the Draft Room; server uses persistent and memory cache before rebuilding.
- Waiver Wire: aggregates settings, claims, players, roster, history, and state; failures are handled by the customer surface, but provider freshness is not independently visible for every row.
- Media: default avatar/logo rather than broken images.
- Optional valuation/weather/news: hidden rather than fabricated.
- Live scoring: cached/live labeling and missing-score warning exist.

## Launch Blockers

1. **Canonicalize score and injury ingestion.** Direct API-Sports cron jobs currently sit outside the provider orchestrator and canonical trace/fallback policy.
2. **Add or formally map an injury capability.** Do not claim canonical injury certification while G49G has no injury capability and `import-injuries` is explicitly deferred.
3. **Run live provider certification with approved credentials.** Verify identity, schedule, live stats, standings, projections, injuries, media, ADP, cache freshness, outages, and rate-limit behavior without fixture substitution.
4. **Verify provider-to-runtime propagation.** Prove that a provider fetch writes the canonical cache/weekly scores and appears in authenticated NFL Redraft UI with matching source timestamps.
5. **Certify stat corrections and stale-cache behavior.** Confirm corrected data rescores matchups and stale data is visibly/operationally handled.
6. **Complete authenticated G48 separately.** Provider source wiring cannot certify league permissions, persistence, or full-season behavior.

## Non-Blocking Follow-ups

- Version the legacy FantasyCalc list/trending/compare contracts behind canonical models.
- Add persisted provider trace history and customer-safe freshness indicators where useful.
- Add alerting for stale evidence, fallback spikes, provider expiration, and repeated sync failure.
- Promote the admin JSON validation route to a visual internal dashboard if operationally valuable.
- Migrate broad multi-sport sync utilities without making enhancement providers load-bearing.

## Provider Certification Plan

1. Configure approved non-production credentials without exposing values.
2. Positively identify the non-production application and database/cache targets.
3. Exercise each canonical capability with real provider responses and record selected provider, timestamp, freshness, cache use, and fallback use.
4. Run the score/schedule/standings/injury ingestion jobs after canonicalization and inspect persisted canonical rows.
5. Verify provider outage, timeout, rate-limit, malformed payload, empty payload, and stale-cache scenarios.
6. In an authenticated commissioner league, confirm provider-derived changes propagate through Draft, Rosters, Matchups, Waivers, and player cards after refresh.
7. Verify no raw payload, secret, or provider-specific identifier leaks to customer responses.
8. Verify stat corrections and replay/rescore behavior.
9. Record exact provider versions/endpoints, response timestamps, retries, cache TTLs, and observed latency.
10. Only then return `READY FOR LIVE PROVIDER CERTIFICATION: YES` or advance to G50.

## Validation

Command:

```text
cmd /c npx vitest run __tests__/g49h-nfl-redraft-production-provider-wiring.test.ts __tests__/g49i-nfl-redraft-provider-validation-dashboard.test.ts __tests__/g49j-nfl-redraft-provider-migration-certification.test.ts __tests__/g50a-nfl-redraft-production-verification.test.ts --pool=threads --maxWorkers=1
```

Result:

```text
Test Files: 4 passed (4)
Tests: 27 passed (27)
Duration: 32.50s
Retries: 0
Timeouts: 0
Live provider calls: 0
Authenticated browser checks: 0
Database-backed checks: 0
```

These passing tests verify contracts, fallback selection, safety boundaries, dashboard inventory, migration wiring, and release evidence logic. They do not certify live provider availability or data correctness.

## Product Progress

G46 and G47 closed two customer-facing launch blockers with unit and browser fixture validation. Treating progress percentage as product implementation rather than release certification supports:

```text
NFL Redraft Beta: 95%
NCAAF Redraft Beta: 80%
Overall August 10 Controlled Beta: 70%
```

The remaining five percent is materially significant: authenticated full-season validation, canonical score/injury ingestion, live provider certification, and final production launch review remain open.

