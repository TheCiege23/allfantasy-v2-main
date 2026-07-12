# Sleeper Import Hardening — Phases 2A & 2B

Implements Milestone 2 ("Sleeper import hardening") of [`docs/os/ALLFANTASY_FANTASY_OS_MIGRATION_PLAN.md`](../../../docs/os/ALLFANTASY_FANTASY_OS_MIGRATION_PLAN.md), following on from Phase 1's [Identity Service](../../shared-services/identity/README.md).

## Import lifecycle, end to end (as of Phase 2B)

```
fetchSleeperLeagueForImport (resilient — retry/backoff/timeout, tagged fetchWarnings)
        │
        ▼
SleeperAdapter.normalize() → NormalizedImportResult (+ fetch_warnings, + coverage)
        │
        ├──────────────────────────────────────────────────────────┐
        ▼                                                          ▼
buildImportedLeaguePreview()                          buildCanonicalImportBundle()
  (existing dataQuality/coverageSummary)                 (folds fetch_warnings into
        │                                                  its existing warnings array)
        ├── buildSleeperImportStatusReport()                       │
        │     → imported/skipped/failed/partial/                  ▼
        │       unsupported/stale per field              persistImportWithCanonicalAudit() /
        │                                                 recordCanonicalImportAuditForExistingLeague()
        └── runSleeperImportValidation()                     (persists ImportRun + ImportWarning rows —
              → league/roster/settings/manager-mapping        canonical.warnings + additionalWarnings
                findings (never blocking)                     from Sleeper validation, both honestly
                     │                                         attributed and durable)
                     └──────── toImportWarningRecords() ─────────────┘
              (same findings also persisted at commit time,
               and returned directly in the preview/commit
               JSON response — exposed AND durable, never just one)
```

Both routes that actually run this end to end:
- `POST /api/league/import/sleeper/preview` — returns the existing preview payload plus new `importStatus` and `validation` fields. Never blocks: a reporting failure is caught, logged, and simply omitted from the response rather than failing the preview.
- `POST /api/leagues/import/commit` and `POST /api/leagues/[leagueId]/import/commit` — for `provider === 'sleeper'` only, runs validation before persisting, folds findings into the same `ImportWarning` audit trail every provider already uses via a new optional `additionalWarnings` parameter (backward compatible — every other provider passes nothing and behaves exactly as before), and returns the `validation` result in the response. A validation `error`-severity finding, or the validation call itself throwing, **never blocks the commit** — this is a deliberate, tested guarantee (see `__tests__/leagues-import-commit-validation-wiring.test.ts`).

## What was hardened

**`SleeperLeagueFetchService.ts`'s `fetchSleeperJson`** was the single confirmed resilience gap from the pivot audit: a bare `try/fetch/catch{return null}` with no retry, no timeout, and no way to distinguish "this data genuinely doesn't exist" from "the request failed." It now goes through `lib/shared-services/import/resilientFetch.ts` — a new, deliberately provider-agnostic retry/backoff/timeout utility (3 attempts, 300/600/1200ms backoff, 12s per-attempt timeout) that is Sleeper's first consumer, not its only intended one. Every fetch site in the Sleeper import path (league, users, rosters, transactions, matchups, draft picks, previous-seasons chain) is now tagged with a logical `field` name and threads a shared `warnings` array, so a persistent failure is recorded — never silently swallowed — while a 404 (or other definitive 4xx) is still correctly treated as "no data," not a warning.

**Structured status/gap reporting** (`SleeperImportStatusReport.ts`) is new: it derives an `imported` / `skipped` / `failed` / `partial` / `unsupported` / `stale` status per data category from the existing `ImportCoverage` self-report plus the new fetch warnings, without replacing `ImportCoverage` (which remains the system of record the preview/commit pipeline actually reads). This is additive, richer status visibility shaped to eventually feed the Fantasy Knowledge Graph's source-attribution/freshness model.

**Validation helpers** (`SleeperImportValidation.ts`) check league completeness, roster completeness, scoring/roster settings presence, transaction/draft availability, playoff-bracket availability (always `unsupported`, honestly — see below), and manager mapping. The manager-mapping check is the one place this phase uses the Phase 1 Identity Service (`resolvePlatformIdentity`) — a genuinely new, read-only code path, not a migration of `commissionerGate.ts`'s own authorization logic, which this phase does not touch.

## What remains unsupported — documented honestly, not papered over

- **`commissionerGate.ts`'s own Sleeper fetches** (`resolveSleeperUserId`, `checkSleeper`) are untouched. They have the identical bare-fetch resilience gap this phase fixed elsewhere, but that file is a permission/authorization gate, not the import data pipeline itself, and this phase's scope was the import pipeline specifically. A follow-up hardening pass for the gate — and for the three `OPEN_READ_PROVIDERS` (MFL/Fantrax/Fleaflicker) requiring no membership proof at all — remains a separate, not-yet-scheduled task.
- **`SleeperHistoricalDraftSyncService.ts`'s traded-picks fetch** is untouched. It's already explicitly self-documented in its own code comment as best-effort ("404 and network errors are swallowed... results are logged for future use") and doesn't persist anywhere yet (`DraftFact` has no metadata column for it) — hardening a fetch with no real consumer would be scope creep with no payoff.
- **`getAllPlayers()` (`lib/sleeper-client.ts`)** — the player-map lookup inside `fetchSleeperLeagueForImport` — has its own internal try/catch this phase does not touch. A failure here still silently degrades to an empty `playerMap`, which is why `SleeperImportStatusReport`'s `COVERAGE_TO_FETCH_FIELD` map has `playerIdentityMap: null` — it honestly cannot attribute a `failed` status to this field today.
- **Playoff bracket *results*** (not just structure) are not modeled in the canonical schema for any provider — confirmed again in this phase, not a new finding. `SleeperImportStatusReport` and `SleeperImportValidation` both report this explicitly as `unsupported`, every time, rather than silently omitting it or miscategorizing it as `imported`.
- **As of Phase 2B, the reporting/validation modules ARE wired into the live preview/commit routes** (see the lifecycle diagram above) — this line is intentionally left in place, struck through in spirit, so anyone reading this file's history understands the modules were built additive-and-unwired first (2A), then connected (2B), rather than assuming they were always live. The next real consumer beyond the routes themselves — an actual import-status UI surface, or the Fantasy Knowledge Graph's signal capture reading these persisted `ImportWarning` rows — is still future work.
- **ESPN, Yahoo, MFL, Fantrax, Fleaflicker fetch resilience** is untouched — this phase is Sleeper-only, per its explicit scope. `resilientFetch.ts` is ready for them to reuse when that work is scheduled (Migration Plan Milestone 10).
