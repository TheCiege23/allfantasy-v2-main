# G50 Canonical Score & Injury Ingestion

Date: 2026-07-12

## Final Decision

```text
G50 CANONICAL SCORE & INJURY INGESTION: PASS
DIRECT SCORE BYPASSES REMOVED: YES
DIRECT INJURY BYPASSES REMOVED: YES
READY FOR LIVE PROVIDER CERTIFICATION: YES
```

This is a source and contract-test decision. It does not claim that any live provider, credential, authenticated league, database target, staging deployment, or production deployment was certified.

## Before

### Fresh call-graph audit

| Path | Direct client / shape | Cache and fallback before G50 | Caller / reachability | Disposition |
| --- | --- | --- | --- | --- |
| `app/api/cron/import-scores/route.ts` | `syncAPISportsGamesToDb`; API-Sports game rows | 90-second `SportsGame` gate; API client rate guard; direct `SportsGame` writes | Vercel cron and authenticated manual cron trigger; production reachable | Replaced for NFL |
| `app/api/cron/import-injuries/route.ts` | `syncAPISportsInjuriesToDb`; API-Sports injury rows | Direct provider fanout and `SportsInjury` writes; no canonical injury policy | Vercel cron and authenticated manual cron trigger; production reachable | Replaced for NFL |
| `app/api/cron/import-schedules/route.ts` | `syncAPISportsGamesToDb` supplement plus Rolling schedule sync | Direct API-Sports diagnostics and writes | Weekly background job; production reachable | API-Sports NFL branch replaced; Rolling schedule importer retained as schedule compatibility path |
| `app/api/sports/sync/route.ts` | Admin-selected API-Sports games/injuries | Direct provider sync into read tables | Admin/bearer production-health surface; production reachable | NFL game/injury branches replaced |
| `lib/api-sports.ts` | Provider client, bounded 30-second abort, rate manager, game/injury fetch and legacy persistence | Provider-specific implementation | Adapter/provider boundary, not customer UI | Retained as adapter implementation |
| `lib/workers/providers/api-sports.ts` | Normalized multi-sport API-Sports adapter | Worker rate manager/provider chain | Generic provider worker; reachable through orchestration infrastructure, not a customer route | Retained as provider adapter boundary |
| `lib/sports-router.ts` | Legacy multi-sport provider router | Normalizes provider data | Broad compatibility router; no focused NFL Redraft customer caller established | Retained and documented legacy |
| `lib/ncaaf-provider/legacyApiSportsIngestion.ts` | NCAAF-only dynamic legacy calls | Existing API-Sports persistence | Explicit NCAAF compatibility boundary | Retained; guard test proves no NFL selector |
| `app/api/redraft/score-sync/route.ts` | Reads cached weekly player stats and populates `PlayerWeeklyScore` | Native DB/cache behavior | NFL Redraft runtime | Retained; it does not call a provider directly |
| `lib/scoring-runtime/resolveNflRedraftLiveScoringRuntime.ts` | `PlayerWeeklyScore`, canonical player data, redraft matchup rows | Native runtime and cached player scores | Matchups/live scoring | Retained; no direct provider call |
| roster, draft, waiver, matchup and player-card injury consumers | `SportsInjury`, canonical/unified player fields | DB/cache reads with null/unknown fallback | Customer reachable | Retained as canonical read consumers; no direct provider call |

Player-news and AI contexts read persisted injury/news state. No customer-facing component or route was found calling API-Sports score or injury functions directly.

### Risk summary

The highest-risk condition was parallel NFL ingestion: scheduled jobs and the admin sync route could write provider-specific rows without the orchestrator's provider selection, canonical contracts, shared cache, freshness trace, or runtime fallback. Injury ingestion also lacked a first-class orchestration capability.

## Canonical Contracts

### Score

`CanonicalNflScore` includes:

- provider game reference;
- NFL sport/league;
- season and week;
- normalized `scheduled`, `live`, `final`, or `unknown` state;
- provider status label;
- scheduled start;
- normalized home/away teams and scores;
- optional period and clock;
- source and fetch timestamps;
- optional correction version.

Malformed rows without a game reference or both teams are rejected. Missing optional scores, clock, period, timestamps, or correction metadata remain `null`; they are never fabricated.

### Injury

`CanonicalNflInjury` includes:

- canonical player ID when resolved;
- provider player reference retained internally for reconciliation;
- normalized player name, sport and team;
- normalized status;
- original provider label as evidence, not product logic;
- injury type/description;
- optional participation, designation and expected return;
- source and fetch timestamps;
- identity confidence.

Product statuses normalize to `active`, `questionable`, `doubtful`, `out`, `ir`, `pup`, `suspended`, or `unknown`. Nameless rows are rejected. Unknown provider labels remain `unknown`.

Canonical identity is resolved during projection using `PlayerIdentityMap.apiSportsId`. When no match exists, the normalized record remains provider-reference-only rather than falsely claiming canonical identity.

### Freshness semantics

The orchestration trace carries provider used, source timestamp, fetch timestamp, `available`/`stale`/`missing`/`unknown`, fallback use, cache use and health state. Canonical cache rows persist the same metadata.

## Architecture

```text
Cron/admin trigger
  -> syncNflRedraftCronCanonicalCache
  -> provider policy and adapter
  -> normalized score/injury contract
  -> SportsDataCache
  -> canonical read-model projector
  -> SportsGame or SportsInjury
  -> existing native Redraft runtime/UI consumers
```

### Orchestrator and adapters

- Added first-class `scores` and `injuries` capabilities.
- Rolling Insights is preferred by policy.
- API-Sports is secondary.
- Canonical cache is the last-known-good fallback.
- Native runtime is terminal fallback and cannot invent provider state.
- API-Sports parsing remains inside the API-Sports adapter.
- Score and injury canonical data is sanitized before cache or route output.
- The existing API-Sports client bounds requests at 30 seconds and uses the shared rate manager.
- Provider fanout deduplicates injury rows; the route cache gate prevents parallel scheduled refetches while injury data is fresh.

### Cache and polling cadence

- Normal in-season cache: 30 minutes.
- Default offseason cache: 4 hours.
- Live score exception: 5-minute canonical TTL while the already-approved two-minute cron/90-second read-model gate remains in place.
- Injury cron skips the provider while its canonical cache entry is fresh.
- No broad cache invalidation was added.

### Native database boundary

Provider scores populate `SportsGame` context/read rows only. Neither the cron routes nor projector import or mutate `RedraftMatchup`; finalized fantasy results remain owned by native league scoring logic.

Injury projection updates `SportsInjury` evidence only. It does not move roster slots, change eligibility, lock lineups, or alter league rules.

## Replaced Consumers

| File | Old path | New path |
| --- | --- | --- |
| `app/api/cron/import-scores/route.ts` | Direct `syncAPISportsGamesToDb` | `scores` capability -> canonical cache -> score projector |
| `app/api/cron/import-injuries/route.ts` | Direct `syncAPISportsInjuriesToDb` | `injuries` capability -> canonical cache -> injury projector |
| `app/api/cron/import-schedules/route.ts` | Direct API-Sports game supplement for NFL | Canonical `schedule` cache sync for NFL |
| `app/api/sports/sync/route.ts` | Direct NFL API-Sports games/injuries | Canonical `scores`/`injuries` sync and projectors |
| `lib/nfl-provider/nflRedraftCronCanonicalSync.ts` | Scores mapped to `live_stats`; injuries deferred | Dedicated `scores` and `injuries` mappings with shared TTL policy |
| `lib/nfl-provider/nflRedraftProductionProviderWiring.ts` | No batch score/injury adapters | Rolling/API-Sports score adapter; API-Sports injury adapter; cache/runtime fallbacks |
| `lib/nfl-provider/nflRedraftProductionVerification.ts` | No evidence/surface entries for new capabilities | Score and injury evidence, canonical object and surface mappings |

## Safety Boundaries

- No credentials or API keys are returned to clients.
- Raw provider objects are not persisted as the public canonical contract.
- Provider-specific parsing stays inside adapters.
- Provider errors advance the fallback chain.
- Cache/runtime fallbacks are traceable.
- Provider state cannot overwrite finalized fantasy matchup results.
- Injury state cannot directly mutate roster eligibility.
- Unknown and stale states remain explicit.
- Provider disagreement remains represented by existing merge conflicts and provider attempt trace.

## Remaining Legacy Paths

| File | Reason retained | Removal plan |
| --- | --- | --- |
| `lib/ncaaf-provider/legacyApiSportsIngestion.ts` | G50 is NFL-only; changing NCAAF ingestion would expand scope | Canonicalize during the NCAAF certification sequence |
| `lib/workers/providers/api-sports.ts` | It is a provider adapter, not a customer consumer | Reuse behind canonical orchestration; do not import from customer routes |
| `lib/sports-router.ts` | Broad multi-sport compatibility router; no focused Redraft customer caller proven | Deprecate/version after caller inventory |
| Rolling `syncNFLScheduleToDb` in `import-schedules` | Existing schedule persistence remains outside score/injury scope | Move schedule materialization behind the canonical schedule projector in a separate phase |
| API-Sports teams/standings/identity operations in admin sync | Not score/injury operations | Address under their own canonical migration phases |
| FantasyCalc list/trending/compare | Explicitly outside G50 | G51 |

No silent parallel NFL score or injury persistence remains in the cron or admin sync entry points audited above.

## Files Changed

- `lib/nfl-provider/nflRedraftProviderOrchestrator.ts`
- `lib/nfl-provider/nflRedraftProductionProviderWiring.ts`
- `lib/nfl-provider/nflRedraftCronCanonicalSync.ts`
- `lib/nfl-provider/nflRedraftScoreInjuryCanonical.ts`
- `lib/nfl-provider/nflRedraftCanonicalScoreInjuryProjector.ts`
- `lib/nfl-provider/nflRedraftProductionVerification.ts`
- `lib/nfl-provider/nflRedraftReleaseCandidate.ts`
- `lib/api-sports.ts`
- `lib/ncaaf-provider/legacyApiSportsIngestion.ts`
- `app/api/cron/import-scores/route.ts`
- `app/api/cron/import-injuries/route.ts`
- `app/api/cron/import-schedules/route.ts`
- `app/api/sports/sync/route.ts`
- `__tests__/redraft/g50-canonical-score-injury-ingestion.test.ts`
- `__tests__/g49g-nfl-redraft-provider-orchestration-platform.test.ts`
- `__tests__/g49h-nfl-redraft-production-provider-wiring.test.ts`
- `__tests__/g50b-nfl-redraft-release-candidate.test.ts`

## Test Evidence

### Focused provider, consumer and release suites

```text
cmd /c npx vitest run __tests__/redraft/g50-canonical-score-injury-ingestion.test.ts __tests__/g49g-nfl-redraft-provider-orchestration-platform.test.ts __tests__/g49h-nfl-redraft-production-provider-wiring.test.ts --pool=threads --maxWorkers=1
```

Result: 3 files, 25 tests passed, 0 failed, 0 skipped, 0 retries, 0 timeouts, 19.98 seconds.

```text
cmd /c npx vitest run __tests__/g49j-nfl-redraft-provider-migration-certification.test.ts __tests__/g50a-nfl-redraft-production-verification.test.ts __tests__/g50b-nfl-redraft-release-candidate.test.ts --pool=threads --maxWorkers=1
```

Result: 3 files, 16 tests passed, 0 failed, 0 skipped, 0 retries, 0 timeouts, 49.05 seconds.

Total final passing evidence: **6 files, 41 tests**.

An earlier combined six-file run timed out at 124.1 seconds and was not counted as passing. Splitting the same suites produced the passing results above.

### ESLint

Targeted ESLint over all touched implementation/routes and the G50 test passed with 0 errors and 0 warnings in 14.4 seconds.

### TypeScript

- Raw `npx tsc --noEmit --pretty false`: timed out once at 124.1 seconds and then exhausted the default 4 GB heap at 159.9 seconds; neither run is counted as passing.
- Repository `npm run typecheck` with 8 GB: failed because `tsconfig.json` includes hundreds of missing `.next/types/**` generated files.
- Focused G50 tsconfig: no G50-touched-file errors remained. It still exited nonzero on pre-existing shared errors in `lib/auth.ts` and the missing `web-push` declaration in `lib/push-notifications/push-service.ts`.

### Diff check

`git diff --check` is reported after the final documentation update. No live provider, Prisma, database, browser or deployment command was run.

## Certification Boundary

Still unverified:

- live credentials;
- real Rolling Insights or API-Sports responses;
- real rate-limit and outage behavior;
- canonical cache/read-model persistence against a real database;
- authenticated application propagation;
- stat corrections and version conflicts with live data;
- staging and production runtime behavior;
- production alerting and operational dashboards.

Fixtures in the tests validate normalization, fallback selection, cache ordering and source guards only. They are not live certification.

## Project Status

Readiness remains unchanged as required:

```text
NFL Redraft Beta: 95%
NCAAF Redraft Beta: 80%
Overall August 10 Controlled Beta: 70%
```

Next phase: **G51 — Legacy FantasyCalc Path Canonicalization**.

