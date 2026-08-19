# Certified Snapshot Reads + Runtime Consumers (Fantasy OS Phase 5C)

## Stop-gate 1 — consumer boundary audit
The real lock/scoring authority already exists and must NOT be overridden: `lib/roster-lineup-engine/lineupLockService.ts`, `lib/redraft/lineupLock.ts`, `lib/redraft/scoringEngine.ts`, `lib/shared-services/game-day/MatchupStateNormalizer.ts`, `WaiverContextAssembler`, trade engines under `lib/trade-engine/`. The Phase 5C ports **enrich** these with canonical sports facts; they never decide locks or scoring. Direct provider calls in those subsystems are to be wrapped by the gateway over time (tracked; not all rewired this phase).

## Stop-gate 2 — certified read semantics (`certifiedReads.ts` + `store.ts`)
- **Certified only** — the store query filters `status='certified'`; partial/rejected snapshots are never returned.
- **Prior certified survives a failed refresh** — a failed run never certifies (5B), so the latest certified stays readable.
- **Freshness belongs to the returned snapshot** — `buildCertifiedFreshness(meta)` uses that snapshot's `generatedAt`/version/provider.
- **Deterministic order** — records returned `ORDER BY canonical_key ASC`.
- **Version + checksum visible**; **unresolved identities distinguishable** (surfaced as a limitation + `resolution_status`).
- **Fails closed** — no certified snapshot ⇒ `unavailable` (never a fabricated empty snapshot).

## Read repository (Part 1)
`CertifiedSportsSnapshotRepository`: `getLatestCertifiedSnapshot` / `getCanonicalRecords` / `getFreshness`. Provider-neutral; no raw provider fields; no direct SQL in OS subsystems.

## Runtime consumer ports
- **Lineup** (`assembleLineupContext` + `LineupSportsRuntimePort`) — lock status from canonical game time (`computeLockStatus`); injury never unlocks; missing/ambiguous schedule ⇒ `unknown`; `canAutoSwitch` requires confident `unlocked` + fresh schedule.
- **Trade** (`assembleTradeContext` + `TradeSportsRuntimePort`) — unresolved identity ⇒ Insufficient Evidence; missing projection stays `null` (never 0); empty stats (never fabricated).
- Both **fail closed** on repository unavailability (empty + `unavailable` context).

## Observability (Part 10)
`summarizeObservability` derives operator metrics (attempts/logical/retries/cache/failures/duration/lag) + a customer-safe status (Current/Delayed/Partial/Unavailable). Never exposes secrets/headers/connection strings/unredacted payloads.

## Disable / rollback
Disable: unset the `FANTASY_OS_EXEC_*` gate → reads fail closed to `unavailable`. Rollback: prior certified snapshot remains readable; nothing destructive.

## Remaining
rosters/transactions/games/stats/projections scopes; Waiver/Matchup port impls; intelligence (League/Commissioner/Manager) + Coach/Chimmy context builder; wiring ports into the live Trade/Waiver/Lineup/Matchup call sites.
