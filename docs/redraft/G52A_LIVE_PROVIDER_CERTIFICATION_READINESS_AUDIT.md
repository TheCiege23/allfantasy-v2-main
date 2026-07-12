# G52A — Live Provider Certification Readiness Audit

Date: 2026-07-12

## Executive summary

G52A passes as a source-readiness audit. The repository has a canonical provider orchestrator, normalized score/injury/valuation contracts, cache metadata, fallback traces, rate-limit records, sync-run telemetry, and protected operator endpoints. No live provider, authenticated browser, database, or production certification was performed.

G52 may begin once a trusted authenticated browser, an authenticated commissioner session, a safe non-production database, and authorized provider credentials are available. A G52 **pass** must remain withheld unless the run captures the evidence below. Current observability is sufficient for a supervised certification run, but not for a fully automated one: provider-resolution traces are not durably retained by the validation dashboard, several adapters lack bounded request timeouts, and per-attempt latency/retry evidence is incomplete.

## Readiness assessment

| Area | Source evidence | Assessment |
| --- | --- | --- |
| Orchestration | Canonical capability policies resolve providers and expose selected provider, attempts, fallback chain, source timestamp, freshness, cache use, health, and warnings. | Ready |
| Normalization | Score, injury, and valuation consumers use canonical contracts and provider adapters. | Ready |
| Cache | `SportsDataCache` retains generated/source timestamps, freshness, fallback, cache, and health metadata. | Ready with manual DB evidence |
| Fallback | Resolution traces distinguish fallback selection, unavailable results, stale/cache use, and warnings. | Ready |
| Rate limits | Persistent API call/rate-limit records and cached fallback exist for API-Sports. | Ready with limitations |
| Timeouts | API-Sports has a 30-second abort timeout. FantasyCalc, TheSportsDB, and inspected Rolling Insights fetch paths do not expose an equivalent bounded timeout. | Gap |
| Retries | Sync telemetry can record retry counts, but provider-client retry attempts are not consistently implemented or recorded. | Gap |
| Provider health | Production health and provider-validation endpoints expose configuration/health summaries. | Ready with limitations |
| Trace history | Dashboard accepts recent resolutions, but its admin route does not populate or persist them; traces can therefore be empty. | Gap |
| Sync jobs | `SyncJobRun` records status, duration, rows, warnings, errors, and metadata. Score/injury extractors do not persist all canonical provider/cache/freshness trace fields. | Gap |

## Preconditions for G52

- Trusted browser bridge attached to the intended session.
- Authenticated commissioner account.
- Explicitly identified, safe, non-production database.
- Authorized provider credentials loaded without exposing them.
- Known application build SHA and environment URL.
- Test league and player/game identifiers recorded.
- Read-only baseline capture completed before any permitted sync action.

Failure of any precondition is a stop gate. Fixtures, mocked authentication, production mutation, and fabricated responses are not substitutes.

## Certification checklist

### Scores

- Trigger a canonical score resolution for a known in-progress or completed NFL game.
- Record request and response timestamps, selected provider, attempted providers, source timestamp, freshness, normalized game/player identifiers, and cache/fallback flags.
- Repeat within cache TTL and prove a cache hit without changing normalized meaning.
- Exercise an authorized provider-failure case and prove deterministic fallback or explicit unavailable behavior.
- Confirm the canonical payload reaches the authenticated customer surface without raw provider fields.

### Injuries

- Resolve a player with a provider-known injury and one without an injury.
- Record source timestamp, freshness, normalized designation/status/details, selected provider, cache state, and warnings.
- Repeat within TTL and prove cache behavior.
- Exercise unavailable/failure behavior and verify stale or fallback data is labeled, never silently presented as fresh.

### Valuations

- Exercise single-player, rankings/list, trending, comparison, trade, and waiver consumers.
- Prove each reaches the canonical valuation gateway and returns normalized contracts.
- Record provider selection, source timestamp, cache state, stale state, warnings, and unavailable behavior.
- Prove a repeated request uses the intended cache and that a provider failure does not leak provider-specific response shapes.

### Runtime

- Capture timeout behavior and elapsed time for each exercised provider.
- Capture retry count/attempt ordering; record `0` when no retry mechanism exists.
- Capture rate-limit state before and after calls and prove limits produce an explicit guarded response or cache fallback.
- Capture provider health before, during, and after the scenario.
- Capture sync-run status, duration, rows written, warnings, errors, and retry metadata.
- Confirm no secret, authorization token, raw provider payload, or customer advice is written to evidence.

## Required G52 evidence packet

For every scenario, retain:

1. Environment URL, build SHA, timestamp window, authenticated role, league ID, capability, and safe test identifiers.
2. Provider-resolution trace: selected provider, ordered attempts, fallback chain, cache flag, fallback flag, health, warnings, source timestamp, and freshness.
3. Sanitized normalized payload or deterministic payload hash plus the expected canonical field list.
4. Relevant `SportsDataCache` metadata: key/capability, generated/source timestamps, expiry, freshness, fallback/cache/health fields.
5. Relevant `SyncJobRun`: job type, start/end, duration, status, rows, warnings, errors, retry count, and sanitized metadata.
6. Relevant API-call/rate-limit evidence: provider, endpoint class, status, measured latency, cached flag, error class, and usage counters.
7. Provider health endpoint output before and after the test.
8. Authenticated browser evidence showing loading, success, empty, stale/fallback, and failure states where applicable.
9. Console and failed-network-request capture.

The evidence packet must distinguish source-verified, authenticated-browser-verified, database-backed-verified, and live-provider-verified claims.

## Remaining gaps

### Certification-blocking if not compensated during G52

- The authenticated browser and safe runtime prerequisites from G48 remain externally blocked.
- Live provider credentials and freshness have not been exercised.
- The admin provider-validation route does not durably populate `recentResolutions`; trace evidence must be captured during the run or instrumentation added first.
- API-Sports call telemetry currently records a zero latency value rather than measured elapsed time, so objective latency evidence needs external timing or a focused instrumentation fix.

### Hardening gaps

- Add bounded abort timeouts to FantasyCalc, TheSportsDB, and applicable Rolling Insights request paths.
- Define provider-specific retry policy and persist per-attempt outcome/latency.
- Include selected provider, freshness, cache/fallback flags, and trace correlation in score/injury sync-run metadata.
- Persist sanitized provider-resolution history and alert on stale/fallback spikes.
- Connect provider health summaries to observed canonical resolution and sync outcomes rather than configuration alone.

The remaining direct-provider audit is limited to broader legacy surfaces: standings ingestion, the partially migrated admin sports sync, and non-redraft weather utility modes. G50 score/schedule/injury paths and G51 FantasyCalc consumers are no longer reported as deferred bypasses.

## Files modified

- `docs/redraft/G52A_LIVE_PROVIDER_CERTIFICATION_READINESS_AUDIT.md`
- `lib/nfl-provider/nflRedraftProviderValidationDashboard.ts`
- `lib/nfl-provider/nflRedraftProductionVerification.ts`
- `__tests__/g50a-nfl-redraft-production-verification.test.ts`

The source changes only correct stale G50/G51 audit classification and its regression assertions. They do not access providers, infrastructure, or databases.

## Validation

- `npx vitest run __tests__/g49h-nfl-redraft-production-provider-wiring.test.ts __tests__/g49i-nfl-redraft-provider-validation-dashboard.test.ts __tests__/redraft/g50-canonical-score-injury-ingestion.test.ts --pool=threads --maxWorkers=1`
  - 3 files passed; 22 tests passed; 0 failed, skipped, retried, or timed out.
- Initial `npx vitest run __tests__/redraft/g51-legacy-fantasycalc-canonicalization.test.ts __tests__/g50a-nfl-redraft-production-verification.test.ts --pool=threads --maxWorkers=1`
  - 2 files; 11 passed, 1 failed. The failure correctly exposed stale deferred-bypass expectations.
- First post-fix rerun of the same command:
  - 2 files; 11 passed, 1 failed. The remaining failure was case-sensitive wording (`FantasyCalc` versus `fantasycalc`), not runtime behavior; corrected before final validation.
- Final rerun of the same Vitest command:
  - 2 files passed; 12 tests passed; 0 failed, skipped, retried, or timed out; 32.39 seconds.
- `npx eslint lib/nfl-provider/nflRedraftProviderValidationDashboard.ts lib/nfl-provider/nflRedraftProductionVerification.ts __tests__/g50a-nfl-redraft-production-verification.test.ts`
  - Passed with 0 errors and 0 warnings.
- `git diff --check`
  - Passed with no whitespace errors. Git emitted only existing working-tree LF-to-CRLF conversion warnings.
- Targeted TypeScript validation was not run separately because both affected TypeScript modules are compiled by the passing Vitest suites; full-repository TypeScript validation remains a documented pre-existing baseline blocker and was outside this audit's minimal-change scope.

## Decision

```text
G52A READINESS AUDIT: PASS
LIVE PROVIDER CERTIFIED: NO
G52 MAY BEGIN ONCE AUTHENTICATED NON-PRODUCTION ACCESS AND AUTHORIZED PROVIDER CREDENTIALS ARE RESTORED: YES, WITH THE EVIDENCE CONDITIONS ABOVE
```

Published readiness remains unchanged:

- NFL Redraft Beta: **95%**
- NCAAF Redraft Beta: **80%**
- August 10 Controlled Beta: **70%**
