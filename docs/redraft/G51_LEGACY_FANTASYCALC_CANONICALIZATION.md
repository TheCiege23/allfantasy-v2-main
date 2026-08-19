# G51 Legacy FantasyCalc Path Canonicalization

Date: 2026-07-12

## Decision

```text
G51 LEGACY FANTASYCALC CANONICALIZATION: PASS
REACHABLE DIRECT PROVIDER CONSUMERS REMOVED: YES
READY FOR G48 RERUN AND G52 LIVE CERTIFICATION: YES
```

This is a source-canonicalization decision only. No provider, credential, browser, database, deployment, staging environment, or production environment was exercised.

## Fresh Audit

The reported legacy usage was real and materially broader than `/api/fantasycalc`.

Reachable direct consumers existed in:

- valuation list, directory, top, trending and comparison responses;
- instant trade and player search APIs;
- trade finder, matchmaking, trade analysis, quick evaluation and proposal generation;
- rankings and player-stock routes;
- roster and season-strategy analysis;
- market alerts and trending dashboards;
- player comparison and outlook;
- waiver intelligence and shared waiver context;
- league decision context and trade-value console services;
- historical, hybrid and VORP valuation helpers;
- replay ingestion and trade-learning capture;
- deterministic AI, chat enrichment and recommendation helpers;
- broad legacy server route modules.

The previous single-player canonical resolver was real. List, directory, trending and comparison consumers still read the provider cache or called the provider client directly.

## Implementation

### Canonical gateway

Added `lib/player-valuations/canonicalPlayerValuations.ts` as the only application-facing valuation entry point.

It provides:

- `getCanonicalPlayerValuations` for normalized list access;
- `getCanonicalValuationSnapshot` for records plus provider-neutral freshness/cache/fallback metadata;
- `getCanonicalPlayerDirectory` derived from canonical valuation records;
- provider-neutral type aliases;
- pure comparison, ranking, tier, pick-value and formatting helpers;
- temporary source-compatible aliases for legacy function names.

The compatibility aliases route through the canonical gateway. They do not call the provider client.

### Existing orchestrator reused

The existing `fantasy_valuations` adapter now accepts league valuation settings and supports batch output as `valuationRecords`. No second FantasyCalc adapter or parallel orchestration path was created.

Flow:

```text
Application consumer
  -> canonicalPlayerValuations
  -> resolveNflRedraftProductionProviderCapability
  -> fantasy_valuations policy
  -> existing provider adapter
  -> DB-first provider cache/client boundary
  -> sanitized canonical records
  -> application consumer
```

Preferred provider failure advances to canonical cache and then the existing hidden/unavailable fallback. Empty and failed resolution returns an empty record set with `source: unavailable`; no values are fabricated.

### Public compatibility route

`/api/fantasycalc` remains temporarily as a URL compatibility alias, but all actions now resolve through `getCanonicalValuationSnapshot`:

- values;
- directory;
- top;
- trending;
- player;
- trade comparison.

Responses use provider-neutral `canonical_provider`, `canonical_cache`, or `unavailable` metadata. Customer-facing empty/error copy no longer instructs users to import FantasyCalc.

### Customer copy

Removed explicit “Powered by FantasyCalc” and FantasyCalc-import messaging from the market UI. Trending cards now identify their source as canonical market values.

## Preserved Ownership Boundaries

No changes were made to ownership of:

- leagues;
- rosters;
- fantasy matchup scoring;
- standings;
- waiver transactions;
- trade execution;
- commissioner data.

Valuations remain optional provider evidence. Missing valuation data does not change native league truth.

## Runtime Consumers Migrated

The direct-import guard covers `app`, `components`, `hooks`, `lib`, and `server`.

Migrated groups and representative files:

- APIs: `app/api/fantasycalc/route.ts`, instant trade/player search, market alerts, roster analysis, season strategy, trade finder/matchmaking, and trade-value player search.
- Trade: league context assembler, analyzer intelligence, trade console, smart recommendations, pre-analysis, drift detection, trade learning and shared trade services.
- Rankings/player intelligence: adaptive and league rankings, player comparison, outlook, trending dashboard, deterministic AI and chat enrichment.
- Waivers: waiver intelligence and shared waiver context.
- Replay/history: Sleeper trade ingestion, normalizer, VORP resolver, historical and hybrid valuation.
- Legacy server routes: player stock, rankings, trade analysis, league analysis, proposal generation, quick evaluation and trade ideas.

In total, 57 runtime files now import the canonical valuation gateway.

## Remaining Provider-Specific Call Sites

Only these source boundaries retain direct provider/cache knowledge:

| File | Reason |
| --- | --- |
| `lib/fantasycalc.ts` | Provider client and pure provider mapping implementation |
| `lib/fantasycalc-db.ts` | Provider-specific DB-first cache implementation used by the adapter |
| `lib/nfl-provider/nflRedraftProductionProviderWiring.ts` | Existing canonical provider adapter boundary |
| `lib/player-valuations/canonicalPlayerValuations.ts` | Gateway type compatibility and provider-neutral orchestration entry point |
| `app/api/health/fantasycalc/route.ts` | Read-only provider-cache health diagnostic; not a customer valuation consumer |

The source guard found no other runtime import of the provider client or provider DB cache.

Remaining cleanup, not a source blocker:

- rename the legacy `/api/fantasycalc` URL behind a versioned provider-neutral route;
- progressively rename compatibility types/functions that still contain `FantasyCalc` in their TypeScript names;
- remove the compatibility aliases after all downstream packages adopt canonical names;
- update internal prompts and telemetry labels where provider attribution is not operationally required.

These items do not bypass the orchestrator.

## Tests

### Canonical gateway

```text
cmd /c npx vitest run __tests__/redraft/g51-legacy-fantasycalc-canonicalization.test.ts --pool=threads --maxWorkers=1
```

1 file, 6 tests passed, 0 failed, 0 skipped, 0 retries, 0 timeouts, 22.14 seconds.

Coverage includes provider routing, sanitized normalization, cache fallback, stale metadata, provider failure, unavailable behavior, directory derivation and repository direct-import guard.

### Public route and player comparison

```text
cmd /c npx vitest run __tests__/fantasycalc-route-contract.test.ts __tests__/player-stats-resolver.test.ts --pool=threads --maxWorkers=1
```

2 files, 6 tests passed, 0 failed, 0 skipped, 0 retries, 0 timeouts, 44.97 seconds.

### Trade, waiver and shared consumers

```text
cmd /c npx vitest run __tests__/trade-analyzer-intel.test.ts __tests__/shared-services/waiver/waiver-context-assembler.test.ts __tests__/shared-services/trade/trade-value-console-shadow-service.test.ts --pool=threads --maxWorkers=1
```

3 files, 26 tests passed, 0 failed, 0 skipped, 0 retries, 0 timeouts, 24.69 seconds.

```text
cmd /c npx vitest run __tests__/trade-engine/trade-learning-capture.test.ts --pool=threads --maxWorkers=1
```

1 file, 20 tests passed, 0 failed, 0 skipped, 0 retries, 0 timeouts, 7.88 seconds.

### AI, league context and replay

```text
cmd /c npx vitest run __tests__/ai/deterministic.test.ts __tests__/league-context-assembler-provider-neutrality.test.ts __tests__/replay-framework/ingestSleeperTradesForLeague.test.ts --pool=threads --maxWorkers=1
```

3 files, 68 tests passed, 0 failed, 0 skipped, 0 retries, 0 timeouts, 16.38 seconds.

```text
cmd /c npx vitest run __tests__/shared-services/trade/trade-value-console-shadow-service.test.ts __tests__/shared-services/waiver/waiver-context-assembler.test.ts __tests__/trade-league-analyze-api.test.ts --pool=threads --maxWorkers=1
```

3 files, 41 tests passed, 0 failed, 0 skipped, 0 retries, 0 timeouts, 18.83 seconds.

Final passing evidence: **13 test files, 167 tests passed**.

One earlier five-file combined command timed out at 124.1 seconds and was not counted. Two expected regression failures occurred before old test mocks were moved from the retired provider boundary to the canonical gateway; the corrected suite passed 20/20.

## Static Validation

- Targeted ESLint over every TypeScript file importing the canonical gateway: passed, 0 errors and 0 warnings, 23.3 seconds.
- `git diff --check`: passed. Git emitted line-ending warnings only.
- Focused G51 TypeScript check: no G51-touched-file error was reported. The command exited nonzero on existing unrelated errors in `lib/auth.ts`, missing `web-push` declarations, and `lib/world-cup/worldCupDataSyncService.ts`.
- Full repository typecheck was not claimed as passing.

## Certification Boundary

Still unverified:

- live FantasyCalc or fallback-provider responses;
- live credentials;
- cache freshness against a real database;
- authenticated application behavior;
- browser rendering;
- staging and production behavior;
- provider latency, rate limits and outages under real traffic.

Fixtures and mocks validate contracts only.

## Readiness

Readiness remains unchanged because G51 removes architectural risk but does not complete authenticated or live-provider certification:

```text
NFL Redraft Beta: 95%
NCAAF Redraft Beta: 80%
Overall August 10 Controlled Beta: 70%
```

Next gates:

1. G48 manual authenticated full-season validation when trusted browser access returns.
2. G52 live provider certification with approved non-production credentials.

