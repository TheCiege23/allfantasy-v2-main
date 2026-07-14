# Trade OS Physical Validation Report

Date: 2026-07-11

## Decision

Trade P0 is source-complete for supported assets but is not physically complete. Database mutation was intentionally not attempted because the required disposable validation credentials were not supplied through the dedicated temporary validation variables. Existing development, test-data, staging, and production-like URLs were not treated as authorization to run destructive migration or failure-injection work.

## Static migration validation

- Migration ordering places `20260711110000_add_trade_execution_snapshots` before the renewal migrations.
- `redraft_seasons` predates the trade migration in `20260407024117_init`; the trade migration does not depend on the later renewal tables.
- The migration creates snapshot and reversal primary keys, unique identities, league/time indexes, and snapshot relations.
- Static review found that `trade_reversals.tradeId` incorrectly referenced only `redraft_trade_proposals`, which would reject generic trade IDs. The native-only foreign key and Prisma relation were removed; the immutable snapshot remains the relational authority.
- Prisma schema validation passes after correction.

No physical migration output, catalog inspection, retry, or rollback output exists because no disposable database was used.

## Reversal validation

Source and contract validation covers supported native player/slot/acquisition/lock/FAAB restoration and generic roster JSON/FAAB restoration, proposal/trade terminal state, immutable reversal, audit, transactional event/outbox, and member notice creation. Static certification also corrected generic readiness to match database rows by roster ID instead of array order.

Physical before/execution/reversal database-state comparisons remain unverified.

## Rollback and concurrency

Failure injection at roster, FAAB, trade state, reversal evidence, audit, event/outbox, and notice persistence was not executed. Concurrent commissioner requests and serializable retry behavior were not executed. The source transaction boundary and uniqueness constraints are present, but they are not substitutes for database evidence.

## Outbox

Producer-side source wiring uses `emitInTx` for canonical reversed and reversal-blocked events. Physical exactly-once persistence, duplicate delivery behavior, and the consumer are unverified.

## Unsupported assets

Draft assets and IDP salary/cap transfers are blocked before restoration because the current immutable evidence is insufficient for deterministic restoration. No partial restoration is intended, but the behavior is not yet database-backed.

## Commands and results

- `npx prisma validate`: passed.
- Targeted Vitest run for atomic reversal contract, reversal readiness, and generic/native evidence parity: 3 files passed, 10 tests passed.
- `git diff --check` on the corrected reversal surface: passed.
- `npx prisma generate`: timed out after 60 seconds during the final run. A prior generation succeeded before these schema corrections; therefore regenerated-client proof is not claimed for the corrected model.
- Physical migration, rollback, contention, and outbox consumer commands: skipped because no approved disposable database credentials were available.

## Gate

Trade P0 remains physically blocked. The next action is to provision the approved disposable Neon validation branch and expose its pooled and direct URLs through dedicated temporary Trade OS validation variables without replacing `DATABASE_URL` or `DIRECT_URL`.
