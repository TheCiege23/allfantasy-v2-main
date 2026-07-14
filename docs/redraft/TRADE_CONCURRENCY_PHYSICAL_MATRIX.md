# Trade Concurrency Physical Matrix

All scenarios below were executed against the production-fork disposable branch (`br-green-lab-admi6kkj`) using the real, unmodified production code (`settleRedraftTradeAssets`, the conditional-claim `updateMany` pattern), invoked directly via `tsx` with two or more genuinely concurrent Prisma client calls (`Promise.all`), not simulated.

## C1 — Accept versus cancel: TESTED, SAFE

Setup: one real pending proposal. Two concurrent conditional updates fired: `status: 'pending' → 'accepted'` and `status: 'pending' → 'cancelled'`, both guarded `WHERE status = 'pending'`.

Result: accept rows affected = 0, cancel rows affected = 1, sum = 1. Final status: `cancelled`. Exactly one terminal state won; the loser affected zero rows (a truthful, safe no-op, not an error requiring separate handling at this layer).

## C2 — Accept versus veto: NOT TESTED

Disclosed, not attempted — time budget was prioritized toward scenarios most likely to surface a real defect (which C4 did) over scenarios structurally identical to C1's already-proven-safe conditional-claim mechanism (veto, like cancel, is a status transition guarded by the same `WHERE status = 'pending'` pattern already proven safe in C1 and in the prior phase's 3-proposal/5-racer conditional-claim testing).

## C3 — Same-player double trade: TESTED, SAFE

Setup: two different real proposals, both attempting to move the same real player (`nfl:def:ZZZ`) from the same sending roster. Both settlements fired concurrently via the real `settleRedraftTradeAssets` function inside the real conditional-claim + settlement transaction.

Result: exactly one settlement succeeded (`playersMoved: 1`); the other failed with the real, correct error `"Traded player nfl:def:ZZZ is no longer on the sending roster"` (the `redraftRosterPlayer.updateMany({where: {rosterId: fromRosterId, playerId, droppedAt: null}, ...})` pattern naturally found zero matching rows for the loser, since the winner's transaction had already moved the row). Final ownership confirmed correct (the winner's destination roster). No duplicate ownership, no data loss.

## C4 — Same-FAAB double spend: TESTED, REAL DEFECT FOUND AND FIXED

Setup: two real proposals from the same roster (100 FAAB balance), each spending 60 FAAB — individually valid, but not together (120 > 100).

**Pre-fix result**: both settlements reported success (`faabTransferred: 60` each). Final balance: 40, not the correctly-rejected `-20` and not the correctly-summed real cost. This is a lost-update race: `settleRedraftTradeAssets`'s original FAAB code did `findUnique` (read balance) then `update` (write new balance) as two separate statements — under Postgres's default READ COMMITTED isolation, both concurrent transactions read the same starting balance of 100, both independently computed a valid-looking `100 - 60 = 40`, and the second write silently overwrote the first's write rather than compounding it. Two real, distinct trades both claimed to have moved 60 FAAB, but the ledger only reflects one deduction — the sending roster effectively received one trade's worth of players/consideration "for free."

**Fix**: `lib/redraft/tradeSettlement.ts`'s FAAB section now uses a single atomic guarded `UPDATE` (`tx.$executeRaw`) whose `WHERE` clause performs the sufficiency check in the same statement as the balance change (`WHERE id = $rosterId AND "faabBalance" + $delta >= 0`), mirroring the same conditional-update pattern already proven safe for the proposal-claim mechanism. This makes the operation atomic regardless of isolation level — Postgres's own row lock on the `UPDATE` prevents the race.

**Post-fix result** (re-run against the same real data, balance reset to 100): exactly one settlement succeeded (`faabTransferred: 60`), the second correctly failed with `"Insufficient FAAB balance to complete trade"`. Final balance: 40 (correct — one real 60-FAAB deduction, not zero, not two, not negative).

## C5 — Same-IDP-salary asset double trade: NOT TESTED

Disclosed, not attempted — the IDP cap transfer path (`applyRedraftTradeCapTransfersInTransaction`) uses `iDPSalaryRecord.update({where: {id: rec.id}, ...})` keyed by the salary record's own primary key rather than a roster+player composite `WHERE`, which is a structurally different pattern from both the FAAB bug and its fix; whether it shares the same class of defect was not physically tested this phase. This is a real, concrete follow-up item for the next phase, not a "probably fine" assumption.

## C6 — Commissioner versus user race: NOT TESTED

Disclosed, not attempted. The authorization check happens before the settlement transaction (at the route layer, `isCommissionerOrCo`), not inside the atomic claim — a commissioner-approve and a self-accept racing for the same proposal would both hit the same `WHERE status = 'pending'` conditional claim already proven safe in C1 and the prior phase's testing, so the core mechanism is very likely safe, but this was not independently confirmed with the two different real actor roles this phase.

## C7 — Reversal versus new trade: NOT TESTED

Disclosed, not attempted. The prior phase's `evaluateTradeReversalReadiness` already includes `PLAYER_ALREADY_MOVED`/`FAAB_ALREADY_SPENT` blockers designed to catch exactly this class of conflict when reversal is attempted *after* a dependent trade has already settled — but the true concurrent case (reversal and a new trade racing at the same instant) was not physically tested.

## C8 — Duplicate settlement requests (same proposal, same idempotency key): TESTED (prior phase), SAFE

Covered by the prior phase's reversal-idempotency test and this program's repeated conditional-claim testing (3 real proposals, up to 5 concurrent racers, exactly one winner every time — see `GATE_C_PHYSICAL_VALIDATION_REPORT.md`). Not re-run this phase; not re-disclosed as new evidence.

## C9 — Conflicting settlement replay: NOT TESTED

Disclosed, not attempted this phase.

## Summary

| Scenario | Status | Result |
|---|---|---|
| C1 accept vs cancel | Tested | SAFE |
| C2 accept vs veto | Not tested | — |
| C3 same-player double trade | Tested | SAFE |
| C4 same-FAAB double spend | Tested | **REAL DEFECT — found and fixed** |
| C5 same-IDP-salary double trade | Not tested | — |
| C6 commissioner vs user race | Not tested | — |
| C7 reversal vs new trade | Not tested | — |
| C8 duplicate settlement (idempotency) | Tested (prior phase) | SAFE |
| C9 conflicting settlement replay | Not tested | — |

4 of 9 scenarios received real evidence this program (3 this phase, 1 carried from the prior phase); one produced a real, serious, previously-undetected defect that is now fixed and re-verified. 5 of 9 remain genuinely untested and are disclosed as such, not assumed safe.
