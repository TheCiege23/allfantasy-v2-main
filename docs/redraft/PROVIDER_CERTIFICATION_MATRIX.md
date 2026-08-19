# Redraft Provider Certification Matrix

This matrix defines how provider behavior must be certified; it does not certify a provider. Capture selected provider and normalized capability at the orchestration boundary. Application consumers must not depend on provider-specific response shapes.

| Provider/capability | Purpose | Sports | Runtime dependency | Cache | Fallback | Health/diagnostic surface | Certification method and evidence | Expected failure behavior | Current state |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Rolling Insights | Player identity, NFL schedule/live-stat backbone, policy slots for media | NFL | Optional behind canonical orchestrator; availability depends on capability | Canonical `SportsDataCache`/imported state | API-Sports, native/canonical cache, or explicit unavailable per policy | Admin redraft provider validation and production-health summaries | Real known player/game; selected/attempted trace, timestamps, normalized hash, cache repeat, outage path, latency | Advance fallback; never expose raw payload/secret | Not live certified |
| API-Sports | Identity, schedule, standings, score/injury ingestion and optional media/news | NFL; other sports outside this gate | Canonical for migrated redraft capabilities; some broader legacy paths remain | API-call cache, canonical cache, persisted score/injury rows | Rolling/native/cache/explicit unavailable by capability | Provider validation, production health, API call/rate-limit records | Capture real response, 30s timeout behavior, rate counters, canonical normalization, sync write and customer propagation | Bounded timeout; cache/fallback or safe unavailable | Not live certified |
| CFBD / NCAAF data adapters | College players, schools, schedules/stats where wired | NCAAF | Required only for the declared NCAAF capability; must never fall back to NFL data | Canonical/persisted NCAAF data | Approved NCAAF cache or explicit unavailable | Existing provider/production health where surfaced; otherwise run log | Known school/player/game, sport isolation, timestamps, normalized fields, cache/failure behavior | Truthful unavailable/stale state; no NFL contamination | Not live certified |
| Sleeper | NFL league import and compatibility identity/ADP paths | NFL | Required during a Sleeper import; not league source of truth after commit | Preview/import metadata and canonical DB after commit | No alternate provider may impersonate imported ownership | Import response/error plus application health/logs | Owned league preview, commissioner proof, warnings, commit, retry/dedupe, resulting DB identity | Safe actionable failure; no partial league or false ownership | Not live certified |
| Fantrax | Intended NCAAF import path where exposed | NCAAF | Only if feature matrix exposes it | Preview/import metadata | Explicit unavailable; never silently switch providers | Import diagnostics/logs | Real owned NCAAF league, ownership/consent, normalization, commit/dedupe | No partial import; customer-safe unsupported/unavailable state | Requires certification |
| ESPN | Secondary import adapter where product scope exposes it | Primarily NFL | Import-time only | Canonical DB after commit | Explicit unavailable | Import diagnostics/logs | Verify visibility first; then ownership, normalization, commit/dedupe | No partial league; clear unsupported/auth error | Source-wired, not live certified |
| FantasyCalc via canonical valuation gateway | Valuation, rankings, trending, comparisons and transaction enrichment | NFL and supported normalized contexts | Optional intelligence; never roster/score/standings truth | Canonical valuation cache | Stale cache if policy allows, then unavailable/hidden | `/api/health/fantasycalc` plus provider validation traces | Exercise each reachable capability, repeat for cache hit, force authorized failure, capture normalized contract and stale labels | Optional value disappears or is labeled unavailable; no provider shape leakage | Canonicalized, not live certified |
| TheSportsDB | Headshots/media enrichment | NFL and supported sports | Optional | Media/canonical cache | Other approved media source then default avatar/logo | Provider validation/production health where available | Known and missing media, cache repeat, timeout observation, attribution-safe normalized URL | Default asset; never block league workflow | Not live certified |
| ClearSports | Tertiary identity/schedule enrichment | NFL | Optional fallback | Canonical cache | Preferred provider/cache then unavailable | Provider validation trace | Exercise only a reachable canonical capability; capture attempt ordering and output | Skip safely; no customer provider leakage | Not live certified |
| OpenWeather | Optional team/game weather context | NFL team-mode where supported | Optional | Canonical weather cache | Hide weather | Capability trace/health where surfaced | Known game/location, timestamp, cache repeat, failure | Hidden/unavailable; never block matchup | Not live certified |
| Canonical provider orchestrator | Provider selection, normalization and fallback policy | NFL/NCAAF by capability | Required boundary for canonical capabilities | `SportsDataCache` and capability stores | Deterministic ordered policy | `/api/admin/redraft/provider-validation`, `/api/admin/production-health` | Prove selected provider, attempts, fallback chain, source/freshness/cache/health/warnings for each capability | Safe normalized unavailable result | Source/test verified |

## Mandatory evidence packet per scenario

1. Environment URL, build SHA, UTC timestamp window, authenticated role, sport, league ID, capability, and sanitized test identifiers.
2. Selected provider, ordered attempts, fallback chain, correlation ID, cache/fallback flags, health, warnings, source timestamp and freshness.
3. Sanitized normalized payload or deterministic hash plus canonical field list; never retain credentials or unnecessary personal data.
4. Relevant cache record metadata: key/capability, generation/source/expiry timestamps and stale decision.
5. Relevant sync-run metadata: status, duration, rows, warnings/errors, retry count and sanitized metadata.
6. Rate-limit/call evidence: endpoint class, status, measured latency, cache flag, error class and counters.
7. Health output immediately before and after the scenario.
8. Authenticated browser evidence for loading, success, empty, stale/fallback and failure states.
9. Console errors and failed requests with disposition.

## Scenarios required for every load-bearing capability

- Fresh success and normalization.
- Repeat within TTL proving the expected cache behavior.
- Expired/stale record proving the declared stale policy.
- Timeout within a bounded interval.
- Rate-limit response and counter behavior.
- Malformed and empty payload.
- Provider failure with deterministic fallback ordering.
- All providers unavailable with customer-safe behavior.
- Provider-to-cache/database-to-authenticated-UI propagation.
- No raw provider fields, brand leakage, secrets, or fabricated freshness.

## Known observability limitations

- Provider-resolution history is not durably populated by every admin dashboard path; capture traces during the certification run or add narrowly scoped instrumentation first.
- Several inspected FantasyCalc, TheSportsDB, and Rolling Insights calls lack consistently proven bounded timeouts.
- Per-attempt latency and retry evidence is incomplete; API-Sports telemetry previously recorded zero rather than measured latency in an inspected path.
- Score/injury sync metadata does not persist every selected-provider/cache/freshness field.

These limitations must be compensated with objective run evidence or fixed before declaring the affected behavior certified. They cannot be waived by a successful happy-path response.
