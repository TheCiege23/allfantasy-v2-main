# Fantasy OS — V8.1 Historical Evidence Persistence Layer

**Branch:** `g15-event-foundation` · **Scope:** internal validation tooling (`lib/validation-cohort/persistence/`).
No customer-facing Operating System change, no Decision OS logic change, no presentation change.

> **What this phase delivers:** a production-grade, provider-neutral **persistence layer** that turns
> historical discovery into a reusable evidence corpus — a store contract + file-backed implementation,
> incremental synchronization, restartable import-state tracking, and engineering integrity checks. Built
> to fixtures + the public `theciege24` smoke path only (no live customer data), and designed so a
> Prisma-backed store is a drop-in.

---

## 1. Part 1 audit — reuse, not duplicate

The product already persists the OPERATIONAL import (`ImportRun`, `ProviderSyncState`,
`DecisionOsImportedActivity`, `prismaImportedActivityStore`). This phase does **not** touch or duplicate
that. It adds a separate **validation evidence corpus** — the discovered portfolios + provider-neutral
per-league facts + import state used for Decision OS verification. It reuses the V7.1 resolver/fetch and
the V7.2 discovery boundary; no parallel importer was created.

## 2. The persistence layer (`lib/validation-cohort/persistence/`)

| File | Role |
| --- | --- |
| `evidenceStore.ts` | `HistoricalEvidenceStore` contract + neutral record types (`PersistedLeagueEvidence`, `PersistedPortfolio`, `ImportState`) |
| `fileEvidenceStore.ts` | File-backed implementation — idempotent upsert by ref, atomic-ish (temp+rename), restartable, immutable-season protection |
| `syncPlanner.ts` | Incremental policy: completed seasons **immutable** (import once → skip); current season **refreshed** |
| `integrityChecker.ts` | Engineering-only checks (duplicate, orphan, broken chain, incomplete roster, transaction consistency, continuity gap) |
| `persistPortfolio.ts` | Orchestrator: resolve → enumerate bounded seasons → plan sync → fetch neutral facts → upsert → update import state |

CLI: `npm run decision-os:validate-sleeper-cohort -- --persist --cohort=<file> --seasons=2024,2023,2022
--currentSeason=2024 [--store=<dir>] [--maxLeaguesPerAccount=N]`. The only live caller; never a customer
request path.

### Historical entities supported (Part 2)

Portfolio, seasons, leagues, league relationships (chains via `previous_league_id`), managers/rosters
(roster summary in the neutral facts), trades / waivers / free-agents (transaction evidence), metadata,
and sync timestamps are persisted today. Standings, matchups, drafts, draft picks, and FAAB values have
**typed store slots** and coverage-matrix categories, populated when a live import gathers them — the
store *supports* them; the current importer marks only what it actually observed (never assumed).

### Incremental sync (Part 3) & import-state tracking (Part 4)

Completed seasons are written once and never overwritten (the file store refuses to rewrite an immutable
record); the current season refreshes each run. Everything is bounded (explicit `--seasons`, concurrency,
optional `--maxLeaguesPerAccount`), idempotent, resumable (already-persisted immutable leagues are
skipped), and partial-failure tolerant (per-league failures are recorded, never abort the batch).
`ImportState` tracks last successful/attempted sync, duration, imported seasons/leagues/transactions,
skipped records, retry count, and partial failures — persisted, so a re-run restarts cleanly.

## 3. Engineering validation (Part 5) — and a real bug the smoke caught

`checkEvidenceIntegrity` runs duplicate / orphan / broken-chain / incomplete-roster /
transaction-consistency / continuity-gap checks (engineering-only, never customer-facing).

The first live smoke reported **182 findings** on a 5-league capped store — almost all false positives:
the portfolio recorded *every discovered* league ref (~300), so the orphan check fired for every
un-imported one. That was a genuine bug in **this tooling** (it conflated "not yet imported" with
"corrupt"). Fixed: the portfolio now records only **persisted** leagues, and orphan means "a persisted
league no portfolio references." Re-run: **182 → 4** findings — the 4 are honest `broken-league-chain`
coverage gaps (the capped 2024 leagues' un-imported 2023 priors), correct for a bounded import. **No
Decision OS change** — this was a tooling fix.

## 4. Decision OS compatibility (Part 6)

The store persists provider-neutral `NormalizedLeagueFacts`, which the **existing** Decision OS probe
consumes unchanged: a test reads a persisted league and runs `probeLeague` → league-health `available`,
no logic modified. No incompatibility was found; no recommendation tuning was done.

## 5. Live verification (tooling, not a customer cohort)

`--persist --username=theciege24 --seasons=2024,2023 --currentSeason=2024 --maxLeaguesPerAccount=5
--maxTxWeeks=2` → imported 5 real leagues, 0 partial failures, ~0.6s, import-state written, **0
provider-id leakage** in the store (scanned), 4 honest integrity findings.

## 6. Tests & typecheck

`__tests__/validation-cohort/persistence.test.ts` (7): store contract + restartability, immutable-season
protection, sync planner, integrity checks (both a dirty and a clean corpus), end-to-end persist with a
temp store (imports, state tracking, restartable immutable-once), and Decision OS compatibility. Full
targeted run **57/57** (validation-cohort + gateway + white-label), 0 failures. Typecheck **158 (baseline
preserved)**, 0 errors in touched files.

## 7. Boundaries honored

Provider identifiers never persisted (anonymized `acct_`/`lg_` refs only); no Decision OS behavior change;
no presentation change; no backend tenancy (file store; DB-backed impl is a documented drop-in); reused
existing discovery/fetch (no duplicate importer); bounded, never a full rebuild on a customer request.

## 8. What remains

Populate the additional evidence categories (standings/matchups/drafts/picks/FAAB) with real fetch+map
when running a live cohort; add the Prisma-backed store implementation for production scale; and — the
recurring blocker — run the **real supplied username cohort** to build the full corpus and validate the
seven Operating Systems against it.
