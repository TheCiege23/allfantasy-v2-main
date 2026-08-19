# Sports Data Runtime Architecture (Fantasy OS Phase 5B)

Turns the Phase 5 gateway foundation into a durable operating runtime. Flow:

```
season-aware scheduler (Phase 4 runner) → durable sync store → Sports Data Gateway →
verified adapter (Sleeper) → canonical normalization → identity resolution →
certified snapshots + incremental events → provider-neutral OS ports
```

## Modules (`lib/sports-data-gateway/runtime/`)
| File | Responsibility |
|---|---|
| `checksum.ts` | Deterministic record content hash (volatile-provenance-insensitive) + snapshot checksum + canonical key |
| `snapshot.ts` | `SnapshotDraft`, `countSnapshot`, `canCertify` (certification gate) |
| `events.ts` | `diffSnapshot` (added/changed/**unchanged-suppressed**) + deterministic `eventId` |
| `store.ts` | `SportsRuntimeStore` — DB-backed `SyncLock`+`SyncStore` (Phase 4 interfaces) + snapshot/event persistence; env-gated, fails closed |
| `sleeperRuntime.ts` | Sleeper `players` scope fetcher + persistScope + `runSleeperPlayersSync` orchestrator (drives the Phase 4 `runSync`) |

## Persistence boundary (Stop-gate 1)
Non-production Neon `cool-lab-87438174` (decision-os-phaseA-verify), db `neondb`, branch `br-red-waterfall-atbib0j0`, **isolated schema `sports_data`** (never the app schema, never production `icy-field`). Tables: `sports_snapshot`, `sports_snapshot_record`, `sports_event`, `sync_run`, `sync_checkpoint`, `sync_lock`, `sync_freshness`. Enabled only when `FANTASY_OS_EXEC_ENABLED=true` + `FANTASY_OS_EXEC_DATABASE_URL` set; **disable** by unsetting either.

## Sync integration (Stop-gate 2)
The runtime does NOT add a scheduler — it implements the Phase 4 `runner.ts` interfaces: `SyncLock.acquire/release` (leased, stale-recovery via `expires_at`), `SyncStore.getCheckpoint/saveCheckpoint/persistScope/recordRun/setLastSuccessfulSyncAt`. The season-aware cadence + due-check are unchanged.

## Invariants (proven)
- `requestAttempts = logicalRequests + retries`
- Partial/failed scope does **not** advance checkpoint; freshness advances **only** after a completed run.
- Snapshots are **append-only**; certified snapshots are never updated in place; a failed replacement leaves the prior certified snapshot available.
- Reruns create **no duplicate** records (deterministic snapshot id + `ON CONFLICT DO NOTHING`) or events (deterministic event id).
- No event for unchanged data (no-change suppression).

## Replay / rollback / disable
Replay: re-run with the same checkpoint — deterministic ids make it idempotent. Rollback: the prior certified snapshot is always queryable (`getCertifiedRecords`). Disable: unset the env gate → the store throws/fails closed and readers get an unavailable state.

## Known gaps (remaining)
OS consumer runtime ports (Trade/Waiver/Lineup/Matchup), intelligence read ports, Coach/Chimmy context, operator observability, and additional Sleeper scopes (rosters/transactions/draft_data) — the `players` backbone patterns them.
