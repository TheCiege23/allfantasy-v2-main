# Durable Sleeper Read-Model Synchronization (Launch Batch 2)

Production synchronization that runs **after** the initial canonical Sleeper import
([Batch 1, PR #344](https://github.com/TheCiege23/allfantasy-v2-main/pull/344)) and keeps the
canonical read model fresh for the dashboard, selected-league context, Decision OS, Chimmy
Intelligence, Rankings, and Commissioner Review.

> **Product boundary.** An imported Sleeper league is a **read-only synchronized data mirror**.
> This system pulls Sleeper data down and refreshes existing AllFantasy records. It performs **no**
> external-platform writes, no AF-native league operations, no lineup/waiver/trade/draft operations.
> Sleeper is keyless and read-only; no credentials are stored.

---

## 1. Audit — pre-existing architecture (origin/main `19e0e2cd3`)

The provider-neutral durable machinery already existed; only the live collector was missing.

| Component | File | State before Batch 2 |
|---|---|---|
| Durable runner | `lib/fantasy-os/sync/runner.ts` `runSync()` | ✅ leased-lock overlap protection + expired-lease steal, retry/backoff/jitter, resumable per-scope checkpoints, idempotent `persistScope`, partial-failure recording, freshness-advances-only-on-completed, full accounting |
| Season cadence | `lib/fantasy-os/sync/season.ts` | ✅ 30 min in-season / 240 min offseason, UTC-date based (DST-invariant) |
| Freshness contract | `lib/fantasy-os/sync/freshness.ts` | ✅ `isSyncDue`, `buildFreshness`, season-aware thresholds |
| Cron heartbeat | `app/api/cron/fantasy-os-exec-sync/route.ts` | ⚠️ existed on `*/30`, but used **one hardcoded run key** `nfl:sleeper:incremental` and read a separate non-prod `fos_phase4` portfolio DB; the live collector was a **stub** (`"live collector not provisioned"`) |
| Live collector | — | ❌ **did not exist** |

**Confirmed audit findings** (all true):
- the provider-neutral durable runner exists;
- the cron heartbeat exists;
- the live collector was **not** provisioned;
- the cron did **not** refresh every connected Sleeper league.

**Additional finding (bug):** `persistImportWithCanonicalAudit` keys `ImportRun.idempotencyKey` on
`userId:provider:sourceLeagueId:season` with **no payload hash** and short-circuits a `completed`
run — so `resyncImportedLeague` (the `/api/leagues/import/resync` route) was a **no-op after the
first import**. Fixed here (see §6).

### Reused primitives (no second sync architecture)
- `fetchSleeperLeagueForImport` — read-only Sleeper client (retries/backoff/timeout; 404/empty = legit no-data).
- `runImportedLeagueNormalizationPipeline` — live fetch + normalize → `NormalizedImportResult`.
- `bootstrapLeagueFromNormalizedImport` — **idempotent, claim-preserving** LeagueTeam/Roster upsert + rebuilt `lineup_sections`.
- `persistTradedPicks` — idempotent `future_draft_picks` upsert.
- `lib/automation/locks` `AutomationLock` — leased distributed lock (owner + TTL + expiry-steal).
- `SyncJobRun` — DB-first sync telemetry sink.

---

## 2. Before / after call graph

**Before**
```
Vercel cron (*/30) ─▶ /api/cron/fantasy-os-exec-sync
                         ├─ resolveCadence(nfl)
                         ├─ fetchLastCompletedSyncAt('nfl:sleeper:incremental')  ← fos_phase4 (non-prod) DB
                         └─ if FANTASY_OS_EXEC_SYNC_LIVE: return "collector not provisioned"  ← STUB
```

**After**
```
Vercel cron (*/30) ─▶ /api/cron/fantasy-os-exec-sync   (FANTASY_OS_EXEC_SYNC_LIVE=true)
                         └─ runDueSleeperLeagues()
                              ├─ enumerateConnectedSleeperLeagues()      → distinct (sleeper, extLeagueId, season)
                              └─ per connection (bounded concurrency, isolated):
                                   syncConnectedSleeperLeague()
                                     ├─ resolveCadence + isSyncDue(lastAttempted)   ← per-league due-check
                                     └─ runSync(runner)                              ← reused durable runner
                                          ├─ AutomationLock  (createAutomationSyncLock)
                                          ├─ SyncStore       (createPrismaSleeperSyncStore → main DB)
                                          └─ ScopeFetcher    (createSleeperScopeFetcher → memoized 1 burst)
                                               loadNormalized = runImportedLeagueNormalizationPipeline (READ-ONLY)
                                                    persistScope ─▶ applySleeperScopeToLeague (per mirror League row)
                                                                      ├─ league_state  → League + LeagueSeason
                                                                      ├─ teams_rosters → bootstrapLeagueFromNormalizedImport (+ removal reconcile)
                                                                      └─ traded_picks  → persistTradedPicks

Manual:  /api/leagues/import/resync ─▶ resyncImportedLeague ─▶ applySleeperScopeToLeague (durable refresh)
         manualRefreshConnectedSleeperLeague / getConnectedLeagueSyncState  ← resolveLeagueAccess-gated
```

---

## 3. Durable state / checkpoint design

New model **`LeagueSyncState`** (table `league_sync_state`) — one row per deterministic run key
`<provider>:<externalLeagueId>:<season>`. A run key can map to several `League` rows (one per
importing user); affected rows are resolved dynamically by `(platform, platformLeagueId, season)`.
No credentials (Sleeper is keyless). Migration is additive `CREATE TABLE IF NOT EXISTS`.

| Field | Purpose |
|---|---|
| `runKey` (unique) | deterministic key + distributed-lock key |
| `provider` / `externalLeagueId` / `season` / `sport` | source identity |
| `checkpoints` (JSON) | per-scope resumable checkpoints (`{ scope: token }`) |
| `completedScopes` / `incompleteScopes` (JSON) | last-run scope outcome (resume targets) |
| `lastAttemptedSyncAt` | advances every run (drives the due-check; prevents hammering) |
| `lastSuccessfulSyncAt` | **certified freshness = AllFantasy's successful-collection time; advances only on a fully completed run (this is AF execution time)** |
| `sourceDataTimestamp` | **RESERVED for a genuine provider-reported source timestamp — left null until one is reliably available (Sleeper exposes no dependable per-league data mtime). Never AF execution time.** |
| `syncStatus` / `seasonState` / `lastRunAccounting` | observability |
| `consecutiveFailures` / `lastError` / `lastRunId` | failure tracking + SyncJobRun link |

Every mirror `League` row also gets `lastSyncedAt` / `syncStatus` / `syncError` stamped so the
dashboard surfaces honest per-league freshness. Each run additionally writes one `SyncJobRun`.

---

## 4. Scheduled cadence

Season-aware, decided **per league** (the fixed heartbeat runs often; the scheduler decides due-ness —
page views are never the only trigger):

- NFL in season (preseason / regular / postseason): **~30 min**
- Offseason: **~240 min (4h)**
- Unknown sport/provider: 4h fail-safe

Boundaries are evaluated on the UTC calendar date (DST-invariant). Bounded concurrency (default 4) +
one memoized provider burst per league keep Sleeper request volume within safe limits.

**Future live-game optimization (documented, not built):** event-sensitive scopes
(`teams_rosters` / matchups) could refresh more frequently during active game windows via a second
tighter cron or a schedule-keyed cadence override. The runner already supports per-scope checkpoints
and a season-aware resolver, so this is an additive cadence change, not an architecture change —
deliberately deferred to keep provider load bounded and this batch focused.

---

## 5. Canonical records updated (idempotent, id-preserving)

Synchronization **updates existing rows**, never creates a league, and preserves `League.id`.

**Synchronized in this PR** — league state/settings; teams and rosters; lineup sections; standings and
matchup-derived TeamPerformance; traded-pick ownership:

| Scope | Canonical writes | Idempotency key |
|---|---|---|
| `league_state` | `League` scalar fields + merged `settings` (AF-managed keys preserved) + current `LeagueSeason` | `League.id`; `LeagueSeason [leagueId, season]` |
| `teams_rosters` | `LeagueTeam`, `Roster` (starters/bench/reserve/taxi via `lineup_sections`), standings + matchup-derived `TeamPerformance` | `[leagueId, externalId]`, roster `platformUserId`, `[teamId, season, week]` |
| `traded_picks` | `future_draft_picks` (traded-pick ownership) | `[leagueId, pickSeason, round, originalRosterId]` |

**NOT yet synchronized** — explicitly out of scope for this PR; classified as the next Sleeper
event-coverage / cadence batch:

- transaction events;
- waiver events;
- trade-event history;
- current draft events / draft state beyond the existing one-time import + `SleeperHistorical*` backfill;
- event-triggered / live-game refreshes.

This PR is **season-cadence** synchronization (≈30 min in season), **NOT** "whenever an event occurs"
synchronization. Scopes with no canonical destination table (e.g. transactions) are deliberately not
synced here — no fabrication. Immutable historical scopes (completed drafts, prior-season snapshots) are
owned by the existing `SleeperHistorical*` backfill services and are checkpoint-skipped by the runner.

**Identity + reconciliation contract (verified by tests):**

- `LeagueTeam.platformUserId` preserves the **raw Sleeper manager id**.
- `Roster.platformUserId` may be the **resolved AllFantasy AppUser id** (when the manager is linked to an
  AF account); the raw Sleeper manager id always remains in `Roster.playerData.source_manager_id`.
- `LeagueTeam.claimedByUserId` survives synchronization (never nulled).
- Authoritative-removal reconciliation (gated on `coverage.currentRosters.state === 'full'`) **cannot
  remove a claimed team or its roster** — a vanished claimed team is marked orphaned, never deleted.

---

## 6. Reimport / manual refresh semantics

- A **second sync or manual refresh resolves the existing canonical `League`** (by
  `platform, platformLeagueId, season`), keeps the same `League.id`, and never creates a duplicate.
- The `/api/leagues/import/resync` route (existing, `requireVerifiedUser`, caller-scoped) is **fixed**:
  for Sleeper it now drives the SAME durable collector as cron via `manualRefreshConnectedSleeperLeague`
  — leased lock, `LeagueSyncState` checkpoints, `SyncJobRun` telemetry, failure accounting, and certified
  freshness (`League.lastSyncedAt` advances only on a completed run) — over the payload already fetched
  (no second provider call). It preserves `League.id` + all mirrors + claims, and returns the refresh
  outcome honestly (completed / partial / failed) instead of silently swallowing a failed refresh.
  Previously it no-op'd entirely on the completed-run ImportRun short-circuit.
- `manualRefreshConnectedSleeperLeague` / `getConnectedLeagueSyncState` are gated by
  `resolveLeagueAccess` (owner **or** a claimed team) — another user can neither refresh nor inspect a
  connection's sync state.

---

## 7. Failure / retry behavior (runner guarantees)

1. Completed immutable historical scopes are not fetched again (checkpoint reuse).
2. Failed scopes resume without restarting completed scopes.
3. A partial or failed run does **not** advance certified freshness (`lastSuccessfulSyncAt`).
4. `lastSuccessfulSyncAt` advances only when all required mutable scopes complete.
5. One failed league does not block another (per-league isolation in `runDueSleeperLeagues`).
6. Overlapping cron executions never process the same league concurrently (leased `AutomationLock`).
7. **A transient empty/error provider response never erases valid stored data** — a hard fetch failure
   throws before persistence runs; an empty roster set is a no-op; removal reconciliation is gated on a
   **complete authoritative** response (`coverage.currentRosters.state === 'full'`), and claimed teams
   are preserved (marked orphan, never deleted).
8. **Runner-level retries are real** — the per-run normalized payload is memoized while in-flight or
   resolved, but a rejected fetch releases the memo so a retry performs a genuinely new bounded provider
   attempt; successful scopes still share one fetch, and provider load stays bounded by `maxRetries`.

---

## 8. Tests

- **Unit** (`__tests__/fantasy-os/sleeper-sync-collector.test.ts`) — enumeration include/exclude,
  read-only provider access, manual-refresh authorization, lock adapter, fetcher determinism, runner
  integration (completed / immutable-skip / lock), the **fail-closed isolated-DB guard** (missing /
  malformed / production / unknown host / wrong db name / no opt-in all refused, no credential leakage),
  and the **memoized-loader retry contract** (one transient failure + success ⇒ exactly two loader
  calls; a normal multi-scope run ⇒ exactly one).
- **Resync delegation** (`__tests__/fantasy-os/sleeper-sync-resync.test.ts`) — the authenticated resync
  utility drives the durable collector, performs no second provider fetch, and surfaces a failed refresh
  honestly.
- **Persisted integration** (`__tests__/fantasy-os/sleeper-sync-integration.test.ts`) — OPT-IN
  (`ALLOW_SLEEPER_SYNC_INTEGRATION_WRITES=true`) against the isolated test DB (`ep-muddy-leaf` / `neondb`),
  behind a **fail-closed** guard that refuses any non-allowlisted database identity before any write
  (F1): durable identity, reimport same id / no duplicate, idempotency, roster starters/bench update,
  removal reconciliation gating, empty/failed-response protection, claim + raw-id survival with a
  **genuinely linked** Sleeper manager, checkpoint resume, freshness gating, overlap lock, per-league
  isolation, dashboard read-model + Chimmy propagation, new-season linkage, and the durable
  manual-refresh path (single fetch; `LeagueSyncState` + `SyncJobRun` written; freshness only on
  completion; lock-out; unauthorized-denied).

All controlled provider fixtures are deterministic (`__tests__/fantasy-os/fixtures/`); no live Sleeper
calls in tests. Persisted writes are **opt-in** and **never touch production**.

---

## 9. Launch Batch 2 · B6 — DB-first current-state refresh (this PR)

**Incident.** A single production manual resync of a deep-dynasty league stayed on "Syncing…" for 7+
minutes and produced no durable artifacts. Root cause: `resyncImportedLeague` front-loaded the **full
initial-import normalization** (`runImportedLeagueNormalizationPipeline`) — which walks the
`previous_league_id` history chain, fetches every historical week, and downloads the ~5MB NFL player
map — **before** the distributed lock was acquired, so it exceeded the serverless execution limit
before the durable collector ever started. Two defects: (a) heavy fetch **outside** the lock, and (b)
routine refresh doing **initial-import-scale** work.

### 9.1 Initial import vs current-state refresh

| | Initial import (first-ever connection) | Current-state refresh (repeat / scheduled) |
|---|---|---|
| Loader | `fetchSleeperLeagueForImport` (**unchanged** — full/historical) | **`fetchSleeperCurrentStateForImport`** (bounded) |
| History chain (`previous_league_id`) | walked | **never** |
| Drafts / per-week transactions / all-week matchups | fetched | **never** |
| Full NFL player map (`/players/nfl`) | fetched | **never** (durable scopes persist player IDs, not names) |
| Current matchups | all weeks | **bounded** current-week window only (≤3 weeks, in-season; **0** in offseason) |
| League.id | created | **preserved** — refresh never creates a league |

A repeat import of an already-imported league shows its **saved** data immediately and queues an
**incremental** current-state refresh; it never re-runs the full historical pipeline. The current-state
payload is the SAME `SleeperImportPayload` → SAME normalizer → SAME persistence (`applySleeperScopeToLeague`)
as §5 — with the historical sections empty. `coverage.currentRosters.state` is still `full` from a
complete rosters fetch, so removal reconciliation (§5) remains correct.

### 9.2 Exact current scopes fetched (bounded request accounting)

`GET /league/{id}` · `/users` · `/rosters` · `/traded_picks` · `/state/nfl` (to gate the window) ·
`/matchups/{w}` for a bounded recent window. **Excluded:** the history chain, `/drafts`, `/transactions/*`,
`/players/nfl`. Worst-case ≈ **4 core GETs + 1 state + ≤3 matchup weeks** — a small, bounded burst that
completes in seconds. Every run still writes one `SyncJobRun` with full accounting.

### 9.3 Lock BEFORE any provider fetch

Both manual and scheduled refresh go through `syncConnectedSleeperLeague`, whose default loader is now
`fetchCurrentStateNormalizedFromSleeper`. The loader is invoked **lazily inside `runSync`**, which
acquires the `AutomationLock` **first** — so no provider fetch happens outside the lock, and a second
overlapping request is rejected as `locked` before it starts a second fetch. Manual and scheduled sync
share one loader, one normalized shape, one lock, one checkpoint/persistence path, one telemetry sink.

### 9.4 DB-first background job (no synchronous request work; survives serverless termination)

Manual resync no longer runs the refresh on the browser request:

```
POST /api/leagues/import/resync  (Sleeper)
  └─ enqueueSleeperRefreshJob → AutomationJob (jobType 'sleeper.currentStateRefresh',
       idempotencyKey 'sleeper-refresh:<runKey>:<bucket>')  ── NO provider fetch ──▶ HTTP 202
        { status: queued | already_running | up_to_date, jobId, leagueId, lastSuccessfullyUpdated }

Vercel cron (*/1) ─▶ /api/cron/sleeper-refresh-drain  (requireCronAuth)
  └─ drain pending jobs → runAutomationJob(handler)
       handler: syncConnectedSleeperLeague(force)  ── lock → current-state loader → persist
                → LeagueSyncState + SyncJobRun → terminal
       outcome mapping: completed → done · locked/partial/failed → RetryableAutomationError (retry)
                        bad payload → FatalAutomationError

GET /api/leagues/import/resync?provider=sleeper&sourceId=…   (UI polls)
  └─ reads latest AutomationJob + LeagueSyncState → phase { refreshing | updated | no_change | failed | idle }
```

**Reused infrastructure — no second job system, no Redis, no schema migration:** the existing
`AutomationJob` + `runAutomationJob` engine (idempotency-keyed, lifecycle, retry, "safe on Vercel
serverless"), `AutomationLock`, `LeagueSyncState` / `SyncJobRun` (from §3), the bounded current-state
loader, and the proven every-minute `legacy-import-drain` cron pattern. The drain is keep-listed in
`scripts/vercel-next-build.cjs` (`app/api/cron` is excluded wholesale).

**Durability.** The job is a durable DB row: it survives browser navigation, refresh, client disconnect,
and serverless termination — a crashed run leaves it pending/running and the next drain pass re-runs it,
guarded by the per-league lock. Nothing is fire-and-forget.

**Quota.** A per-user in-flight cap + a per-league cooldown keyed on the **last successful** sync
(`lastSuccessfulSyncAt`) — so a failed job never consumes the allowance.

### 9.5 UI (stale-while-refresh, honest terminals)

`ImportedLeaguesPanel` enqueues, then polls the DB-backed status. The **previous DB snapshot stays
visible** throughout; navigation is safe (the job is durable); double-clicks dedupe to one request
(disabled button + idempotency key). It exits "Refreshing" on **every** terminal outcome with honest
labels — **Updated** / **Checked — no new information** / **Refresh failed — your previous data is still
available** / **Too many refreshes in progress** / (past the poll deadline) **Refreshing in the
background** — and never reports "Queued" for a failure or timeout. Last-checked and last-successfully-
updated are shown separately.

### 9.6 Downstream intelligence & event coverage (unchanged deferrals)

DB-first by design: the worker refreshes the canonical read model + freshness; the dashboard, League
pages, Decision OS, Chimmy, Rankings and valuation read **saved DB state**, so they reflect the refresh
on their next read — this PR triggers **no** new downstream recalculation (Import-to-Intelligence stays
out of scope). Event coverage (transactions / waivers / trade-event history / live-game refreshes) remains
deferred exactly as in §5.

### 9.7 Activation boundary

The new drain cron processes **ONLY** user-enqueued manual-refresh jobs. The automatic all-leagues
portfolio sweep (`/api/cron/fantasy-os-exec-sync`) remains **disabled** behind `FANTASY_OS_EXEC_SYNC_LIVE`
— this PR does not enable it. Read-only against Sleeper; no schema, env, or production-data change.

---

## 10. Tests (this PR)

- **Bounded current-state fetch** (`sleeper-current-state-fetch.test.ts`) — a deep-dynasty league is
  refreshed with **no** history-chain / drafts / transactions / player-map calls (bounded count); the
  in-season matchup window is bounded; and the **initial import fetch is unchanged** (still full/historical).
- **Enqueue** (`sleeper-refresh-enqueue.test.ts`) — returns fast with **no** provider fetch; creates one
  pending `AutomationJob`; duplicate clicks reuse one job; per-user quota → 429; cooldown → up-to-date.
- **Worker + runner** (`sleeper-refresh-worker.test.ts`) — lock acquired **before** any fetch; a failed
  run never advances freshness; a locked executor performs zero fetches; honest outcome mapping
  (completed / locked→retry / partial→retry / bad-payload→fatal); scheduled + manual call the SAME
  collector entry.
- **Route** (`sleeper-sync-resync-route.test.ts`) — Sleeper POST → **202** with no inline refresh;
  quota → 429; non-Sleeper keeps the inline path; GET status phase mapping.
- **UI** (`imported-leagues-panel.test.tsx`) — enqueue → poll → exits "Refreshing" on success / durable
  failure / 429 / network error / background-deadline; snapshot stays visible; double-click → one request.
- **Route budget** (`route-budget.test.ts`) — the new drain cron is keep-listed and scheduled; GREEN.

Idempotency, League.id preservation, and failure-preservation continue to be covered by the #345
collector + isolated-DB integration suites (§8).

---

## Scope confirmation

No external-platform writes · no AF-native league operation · no `RedraftSeason` added for imported
analysis · no admin work · no Stripe work · no other provider activated · **automatic sync
(`FANTASY_OS_EXEC_SYNC_LIVE`) not enabled** · **no schema/env/production-data change** · **no
Import-to-Intelligence recalculation** · PR #339 untouched · read-only against Sleeper.
