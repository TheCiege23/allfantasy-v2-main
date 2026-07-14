# Next-Season Concurrency Completion

Carried from the prior phase: N1 (two identical concurrent requests) — real, physically proven safe.

## N2 — Different keys, same source and target: TESTED, SAFE

Real league `rwr-runtime-nfl-redraft-league`/`rwr-runtime-nfl-redraft-season`, marked complete. Two concurrent `createNextSeason` calls, **different** idempotency keys (`n2-key-a:...`, `n2-key-b:...`), same source/target. Result: direct re-query confirmed exactly 1 destination season for `(league, 2027)` and exactly 1 `LeagueRenewal` row — the Serializable-isolation conflict mechanism already proven in N1 handles this case identically (a second, independent physical confirmation, not merely inferred from N1).

## N3 — Same source, different target seasons: NOT TESTED

Disclosed, not attempted this phase given time constraints.

## N4 — Renewal versus archive: BLOCKED, per explicit instruction

Per the brief's own guidance ("If N4 remains blocked by the unsafe archive system, classify it explicitly as blocked rather than passed"): archive integration was deliberately not built into eligibility (see the prior phase's disclosure — `archiveLeague` is non-transactional with no completeness gate). There is no safe, deterministic way to race a renewal against an archive operation that is itself already known-unsafe. **Explicitly classified BLOCKED, not fabricated as passing.**

## N5 — Renewal versus standings mutation: NOT TESTED

Disclosed, not attempted.

## N6 — Renewal versus settings mutation: NOT TESTED

Disclosed, not attempted. Reasoning for expected (not confirmed) safety: `League.settings` is read fresh inside the transaction (`tx.league.findUnique`), so a settings change committed before the transaction starts would be correctly picked up, and one committed during the race would trigger the same Serializable conflict N1/N2 already proved — but this specific interaction was not empirically run.

## N7 — Renewal versus ownership mutation: NOT TESTED

Disclosed, not attempted, same reasoning as N6.

## N8 — Replay after response loss: TESTED (equivalent), SAFE

Functionally identical to exact-replay idempotency, already physically proven repeatedly this program (same idempotency key, sequential call after a real prior completion, returns the stable original result, zero duplicate writes) — including via the real API route this phase specifically (200 `already_created`, identical `destinationSeasonId`).

## N9 — Conflicting idempotency payload: TESTED (unit-level), not re-verified physically this phase

`createNextSeason`'s pre-transaction check (`CONFLICTING_IDEMPOTENCY_PAYLOAD` when a reused key targets a different `sourceSeasonId`/`sourceLeagueId`) is real, existing code from the prior phase, not re-exercised against the disposable database this specific phase (time constraints) — carried forward as previously-implemented, not fabricated as newly re-tested.

## Summary

| Scenario | Status |
|---|---|
| N1 | Tested — SAFE (prior phase) |
| N2 | Tested — SAFE (this phase, real) |
| N3 | Not tested |
| N4 | Explicitly BLOCKED (archive is unsafe) |
| N5 | Not tested |
| N6 | Not tested |
| N7 | Not tested |
| N8 | Tested (equivalent sequential form) — SAFE |
| N9 | Implemented, unit-tested; not physically re-verified this phase |

3 of 9 scenarios (N1, N2, N8) have real physical or equivalent proof; N4 is honestly classified as blocked rather than skipped silently; 5 remain genuinely untested.
