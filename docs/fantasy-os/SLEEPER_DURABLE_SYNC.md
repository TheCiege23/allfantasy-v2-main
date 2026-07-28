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
| `lastSuccessfulSyncAt` | **certified freshness — advances only on a fully completed run** |
| `sourceDataTimestamp` | provider as-of time |
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

| Scope | Canonical writes | Idempotency key |
|---|---|---|
| `league_state` | `League` scalar fields + merged `settings` (AF-managed keys preserved) + current `LeagueSeason` | `League.id`; `LeagueSeason [leagueId, season]` |
| `teams_rosters` | `LeagueTeam`, `Roster` (starters/bench/reserve/taxi via `lineup_sections`), `TeamPerformance` | `[leagueId, externalId]`, roster `platformUserId`, `[teamId, season, week]` |
| `traded_picks` | `future_draft_picks` | `[leagueId, pickSeason, round, originalRosterId]` |

Preserved on every sync: **`League.id`**, **`LeagueTeam.claimedByUserId`** (never nulled), raw Sleeper
manager ids (`platformUserId`), and canonical `lineup_sections`. Scopes with no canonical destination
table (e.g. transactions) are **not** synced — no fabrication. Immutable historical scopes (completed
drafts, prior-season snapshots) are owned by the existing `SleeperHistorical*` backfill services and
are checkpoint-skipped by the runner.

---

## 6. Reimport / manual refresh semantics

- A **second sync or manual refresh resolves the existing canonical `League`** (by
  `platform, platformLeagueId, season`), keeps the same `League.id`, and never creates a duplicate.
- The `/api/leagues/import/resync` route (existing, `requireVerifiedUser`, caller-scoped) is **fixed**:
  for Sleeper it now drives the durable collector over the payload already fetched (no second provider
  call), so a re-sync actually refreshes canonical rows instead of no-op'ing on the completed-run
  short-circuit.
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

---

## 8. Tests

- **Unit** (`__tests__/fantasy-os/sleeper-sync-collector.test.ts`, 12) — enumeration include/exclude,
  read-only provider access, manual-refresh authorization, lock adapter, fetcher determinism, runner
  integration (completed / immutable-skip / lock).
- **Persisted integration** (`__tests__/fantasy-os/sleeper-sync-integration.test.ts`, 12) — against an
  **isolated test DB** (`ep-muddy-leaf`) with a hard production-refusal guard (`ep-curly-block`):
  durable identity, reimport same id / no duplicate, idempotency, roster starters/bench update,
  removal reconciliation gating, empty-response protection, claim + raw-id survival, checkpoint resume,
  freshness gating, overlap lock, per-league isolation, dashboard read-model + Chimmy propagation,
  new-season linkage.

All controlled provider fixtures are deterministic (`__tests__/fantasy-os/fixtures/`); no live Sleeper
calls in tests. **Never writes to production.**

---

## Scope confirmation

No external-platform writes · no AF-native league operation · no `RedraftSeason` added for imported
analysis · no admin work · no Stripe work · no other provider activated · PR #339 untouched · read-only
against Sleeper.
