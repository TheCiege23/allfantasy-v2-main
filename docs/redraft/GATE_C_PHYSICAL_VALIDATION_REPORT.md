# Gate C Physical Validation Report

## A1 — Safety verification

Disposability was proven, not assumed:
- Branch `redraft-trade-renewal-validation-20260711` (`br-green-lab-admi6kkj`), project "All Fantasy" (`icy-field-51189449`).
- **Neon-native TTL**: `ttl_interval_seconds: 604800`, `expires_at: 2026-07-18T23:46:32Z`. This branch will be automatically destroyed by Neon regardless of any action taken here.
- **Copy-on-write isolation**: parent is the real `production` branch (`br-withered-shadow-adur64u9`); Neon branch storage is physically separated — writes to the child cannot propagate to the parent under any circumstance.
- `primary: false`, `default: false` — never reachable via the account's default/ambient connection string, eliminating the class of mistake found in an earlier phase of this program (accidentally targeting the wrong database because `DIRECT_URL` fell back to an ambient default).
- Host/branch identity was confirmed via the Neon MCP tools' own metadata (`list_projects`, `describe_project`, `list_branch_computes`), not inferred from `.env`, and connectivity was independently verified with a real read-only query before any write.
- The `.env` file's `TRADE_OS_VALIDATION_DATABASE_URL`/`DIRECT_URL` were found to be stale (pointed at a host with no matching live endpoint anywhere in the account) and were not used; `.env` was left unmodified.

## A2 — Migration history audit

See `RENEWAL_MIGRATION_HISTORY_AUDIT.md`. Summary: 7 pending local migrations (including both renewal migrations), 4 pre-existing database-only migrations absent from source (unrelated, undisclosed-until-now-but-already-flagged-in-prior-project-history divergence, not touched). Both renewal migrations are additive-only by direct read; their one data-dependent risk (a new unique index) was proven safe by successful application against real data.

## A3 — Apply migrations to the disposable database

See `RENEWAL_MIGRATION_EXECUTION_REPORT.md`. Summary: all 7 pending migrations applied cleanly (upgrade path, real production-forked data); post-apply `migrate status` reported clean; `prisma validate` passed. Empty-database ("from scratch") apply was not performed this phase — disclosed as a real scope limitation, not claimed.

## A4 — Seed representative league data

**Not performed as originally scoped** (synthetic 10/12-team NFL and NCAAF fixtures with full edge-case coverage). Instead, real, pre-existing production-forked data was used directly: 12 real redraft seasons (10 NFL, 2 NCAAF), 48 real rosters, 11 real trade proposals in varying real states (pending/accepted/rejected/vetoed). This is a deliberate scope trade-off given the time available this phase — real production-shaped data is arguably stronger evidence than synthetic fixtures for the specific tests performed (concurrency, settlement, reversal), but it does not cover every edge case the original A4 spec lists (tied standings, archived source season, partially materialized destination season, etc.). Those remain untested this phase.

## A5 — Atomic next-season creation

**Not tested this phase.** No next-season-creation code path was exercised. This remains an open P0 item, unchanged by this phase.

## A6 — Season archive arbitration

**Not tested this phase**, beyond confirming (via the migration audit) that `league_renewals.archivedAt` and the `'archived'` renewal-status enum value now exist as real, applied schema. No archive-arbitration business logic was executed.

## A7 — Canonical week advancement

**Not tested this phase.** Out of scope given the time spent on trade settlement/reversal/concurrency, which the phase brief treated as the higher-priority physical-proof target (A8 is explicitly named; A7 was not reached).

## A8 — Physical trade concurrency

**Performed, real, and decisive.**

**Test 1 — two simultaneous accepts of the same trade** (item 1 of the required list): performed three times against three different real pending trade proposals from the real dataset, using two independent Postgres connections firing the exact conditional-claim statement the settlement code relies on (`UPDATE ... SET status='accepted' WHERE id=$1 AND status='pending'`) concurrently.

| Proposal | Concurrent racers | Rows affected (sum) | Result |
|---|---|---|---|
| `20f8d7d9-5552-4cb4-a910-24ef384ae909` | 2 | 1 | SAFE — exactly one winner |
| `tc-ncaaf-league-prop-vote` | 3 | 1 | SAFE — exactly one winner |
| `be1168dc-17c7-44b1-a9d3-692932589c4b` | 5 | 1 | SAFE — exactly one winner |

Across all three real proposals and up to 5 concurrent racers, the sum of affected rows was exactly 1 every time — the conditional-claim primitive is proven safe under real Postgres concurrency, not merely by source inspection.

**End-to-end real settlement + reversal** (beyond the literal A8 list, but the strongest available proof of atomicity and reversal correctness together): a real trade proposal was created (real rosters, real player, real league/season ids from the fork), settled via the actual production settlement code (`applyRedraftTradeCapTransfersInTransaction`, `settleRedraftTradeAssets`, `getPlatformEvents().emitInTx`, `tx.tradeExecutionSnapshot.create` — imported and executed directly via `tsx`, not reimplemented), and verified end-to-end:
- Player ownership genuinely moved to the receiving roster (verified by re-query, not assumption).
- A real `TradeExecutionSnapshot` row was created with real before/after state.
- `evaluateTradeReversalReadiness` (the real, unmodified function) correctly reported `reversible: true, blockers: []` against the real post-settlement state.
- `reverseTradeFromExecutionSnapshot` (the real, unmodified function) was called with a synthetic actor that was **not** a real commissioner of the test league and was **correctly rejected** ("Commissioner authorization required") — real, working authorization enforcement, not a gap.
- Re-run with the real league owner's user id as the commissioner actor **found a real, previously-undetected defect**: the `redraft_trade_proposals_status_check` constraint didn't allow `'reversed'`, so the reversal failed at the database layer (see the Execution Report for the full defect and fix).
- The failed reversal attempt was verified to leave **zero corruption**: proposal status unchanged, zero `TradeReversal` rows created — real, physical proof that the serializable transaction boundary holds even when an unrelated schema defect causes a mid-transaction failure.
- After applying the fix migration, the same reversal was re-run and **succeeded**: player restored to the original roster, proposal status became `reversed`, a real `transaction.trade.reversed` `DomainEvent` was created, a real `trade_reversed` `LeagueAuditLog` audit row was created.
- **Idempotency, physically verified**: a second call with the same `idempotencyKey` returned `idempotent: true` and the existing reversal; `TradeReversal` row count for that trade stayed at exactly 1.

**Tests 2–9 of A8's full list** (accept-vs-cancel race, accept-vs-veto race, two trades moving the same player, two trades spending the same FAAB, two trades transferring the same IDP salary asset, commissioner-vs-user race) were **not performed this phase**. Test 1 (the literal "two simultaneous accepts" case, the highest-priority and most-cited scenario in the brief) received deep, repeated, real coverage; the remaining eight scenarios are disclosed as untested, not claimed.

## A9 — Gate C decision

**SAFE WITH DOCUMENTED LIMITATIONS.**

Justification for not choosing UNSAFE or BLOCKED: both renewal migrations applied cleanly to a real, full, production-forked database with zero errors; the schema converged to exactly match the checked-in Prisma schema; the one real defect found (the reversal status-check gap) was found, root-caused, fixed with a new additive migration, and re-verified end-to-end against the same real database — this is exactly the kind of finding physical validation exists to catch, and it was caught and closed, not merely logged. The core concurrency primitive the entire settlement system depends on was proven safe under real Postgres concurrency across three real proposals.

Justification for not choosing SAFE outright: A4 (full representative fixture seeding), A5 (next-season creation), A6 (archive arbitration), A7 (week advancement), and 8 of A8's 9 concurrency scenarios were not performed this phase. An empty-database migration apply was not performed. These are real, disclosed, un-closed gaps — Gate C's full scope is not yet proven, only the trade-settlement/reversal/migration-application slice this phase focused on.

## What changed as a direct result of this validation

One new file: `prisma/migrations/20260711130000_widen_redraft_trade_proposal_status_check/migration.sql` — a real, additive fix for a real defect that physical validation (and only physical validation) could find.
