# Sports Data Runtime — Proving Run (Fantasy OS Phase 5B)

One tightly-scoped, non-production run: provider **Sleeper**, sport **NFL**, capability **players**, 15-record sample, run key `sports:nfl:players:proof`. Executed against non-prod `sports_data` (never production).

## Evidence (all confirmed)
| Requirement | Result |
|---|---|
| Scheduler lock acquired | ✅ leased `sync_lock` acquired via `SportsRuntimeStore` |
| Runner created | ✅ Phase 4 `runSync` drove it |
| Gateway selected Sleeper | ✅ selection rule primary=sleeper |
| API request succeeded | ✅ real Sleeper `players/nfl` |
| Schema validation passed | ✅ adapter validated payload map; records `schemaValid` |
| Canonical records produced | ✅ 15 `CanonicalPlayer` |
| Identities resolved / quarantined | ✅ **2 resolved / 13 unresolved (quarantined)** — no fabricated canonical ids |
| Snapshot persisted + certified | ✅ 1 `certified` snapshot, append-only |
| Checksum calculated | ✅ deterministic (snapshot id derived from content checksum) |
| Events inserted | ✅ **15 events, 15 distinct ids** (run 1) |
| No-change suppression | ✅ run 2 emitted **0** new events |
| Checkpoint advanced | ✅ `sleeper-players-nfl:2026-07-12` |
| Freshness advanced | ✅ `sync_freshness.last_successful_sync_at` set |
| OS consumer retrieved certified data | ✅ `getCertifiedRecords('NFL','players')` → 15 records |
| Rerun created no duplicates | ✅ run 2: **imported=0, unchanged=15**; still 1 snapshot, 15 events |
| Request accounting reconciled | ✅ attempts(1) = logical(1) + retries(0) |

## Run summary
- **Run 1:** `status=completed`, `advancedFreshness=true`, imported 15 / unchanged 0 / rejected 0.
- **Run 2 (rerun):** `status=completed`, imported 0 / unchanged 15 → **idempotent + no-change suppression**.
- DB after both runs: `certified_snapshots=1`, `snapshot_records=15`, `events=15` (`distinct_event_ids=15`), `resolved=2`, `unresolved=13`, `runs=2`, `freshness_advanced=true`.

Temp proving script + DB credential file were deleted; no secret was committed or logged.
