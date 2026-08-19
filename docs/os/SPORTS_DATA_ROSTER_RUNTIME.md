# Sports Data Roster Runtime (Fantasy OS Phase 5D, Part 1)

League-scoped, incremental, certified Sleeper roster synchronization. `lib/sports-data-gateway/runtime/rosterRuntime.ts`.

## Canonical contract
`CanonicalRosterSnapshot`: `canonicalLeagueId`, `canonicalRosterId`, `canonicalManagerId`, season, `playerIds`/`starterIds`/`reserveIds`(bench)/`taxiIds`/`injuredReserveIds` (all canonical), `providerRosterId`, `unresolvedCount`. Player ids resolve to canonical identity; **unresolved ids are quarantined** (kept as `unresolved:sleeper:<id>`, never dropped). Unresolved counted **once per distinct player**, not per list.

## League dimension
Roster snapshots are keyed by `(sport, capability='rosters', scope_ref=<leagueId>)` — a `scope_ref` column added to `sports_snapshot` (non-destructive; the global `players` scope keeps `scope_ref = NULL`, unaffected).

## Events (Part 1)
Per-player diff vs the previous certified roster snapshot for the same league: `roster_player_added`, `roster_player_removed`, `roster_player_moved` (starter↔bench for a retained player). Deterministic ids (`eventType|rosterId|playerId|version`) ⇒ **no duplicate events on rerun**. `roster_snapshot_corrected` reserved for versioned corrections. A roster change is **never** interpreted as a waiver/trade/manager decision without transaction evidence.

## Certification + idempotency
Reuses the 5B certification gate + append-only snapshot (deterministic snapshot id from content checksum). Freshness/checkpoint advance only after certification. Rerun with identical rosters ⇒ same snapshot (ON CONFLICT DO NOTHING) + 0 events.

## Proving run (real, non-prod)
League `1092671852352331776` (real fos_phase4 portfolio league, 10 rosters). Run 1: **1 certified snapshot, 10 records, 264 added-player events**, 237 unresolved refs quarantined. Run 2 (rerun): same snapshot, **0 new events** (idempotent). DB-verified: `certified_roster_snapshots=1, roster_events=264 (264 distinct)`; the `players` snapshot stayed intact.

## Disable / rollback
Disable via the `FANTASY_OS_EXEC_*` gate. Rollback: append-only + prior certified snapshot preserved; nothing destructive.

## Remaining
Wire roster snapshots into League/Manager Intelligence coverage metrics; starter/reserve movement richer classification; transaction-evidence correlation (separate transaction scope).
