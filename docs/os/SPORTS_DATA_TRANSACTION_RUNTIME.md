# Sports Data Transaction + Schedule Runtime (Fantasy OS Phase 5D-b)

## Sleeper transactions (`runtime/transactionRuntime.ts`, Parts 1–2)
- **CanonicalLeagueTransaction** — canonical ids, `type` (trade/waiver/free_agent/commissioner/roster_adjustment/**unknown**), `status` (pending/complete/failed/cancelled/unknown), rosterIds, playerAdds/Drops (canonical, quarantined if unresolved), faabTransfers, draftPickTransfers.
- **Type + status classified deterministically from provider fields** — never inferred from roster diffs. Unknown provider values **retained** as `unknown`, not dropped.
- League+season scoped (`scope_ref = <leagueId>-<season>`); bounded week window, overlap-safe (provider transaction_id dedup + deterministic event/record ids). Checkpoint = `w1-w<maxWeeks>`; advances only after certification.
- Events: `trade_observed`/`waiver_observed`/`free_agent_move_observed`/`commissioner_adjustment_observed` (+ status/pick variants). Deterministic ids ⇒ rerun = 0 duplicate records/events.

**Proving run:** real league `1092671852352331776` — 95 transactions (33 waiver / 59 free-agent / 3 trade), 105 unresolved quarantined, 95 events; rerun → 0 new.

## ESPN schedules/games (`runtime/scheduleRuntime.ts` + `providers/espn.ts`, Parts 5–6)
- **CanonicalGameSchedule** from ESPN scoreboard (schema-validated; malformed rejected). Scoped `scope_ref = <season>-w<week>`.
- Events: `game_created`/`game_started`/`game_final`/`game_postponed`/`game_suspended`/`game_delayed`/`game_cancelled`/`game_corrected` — only on change (unchanged suppressed).

**Proving run:** ESPN NFL — 16 games certified, 16 `game_created` events; rerun → 0 new. Two providers now certified in `sports_data`: `espn, sleeper`.

## Accounting (Part 13)
Schedule/transaction fetches classify logical requests + attempts (`attempts = logical + retries`); accepted + quarantined + rejected = observed records (quarantined = unresolved identities; rejected = schema failures).

## Disable / rollback
Disable via the `FANTASY_OS_EXEC_*` gate. Append-only + prior certified snapshot preserved.

## Known limitations / remaining
- Sleeper **draft** scope not built this increment.
- ESPN **injuries/availability** not available from the scoreboard → deferred (needs a real injury feed).
- **Lineup lock enrichment** needs cross-provider team identity (Sleeper team ↔ ESPN team) before player→game mapping.
- Live **Waiver/Trade/Matchup** call-site wiring not done this increment.
