# Renewal Migration Execution Report

## Environment

Disposable Neon branch `redraft-trade-renewal-validation-20260711` (`br-green-lab-admi6kkj`), project "All Fantasy" (`icy-field-51189449`), forked from the real `production` branch via Neon copy-on-write, TTL 7 days (`expires_at: 2026-07-18T23:46:32Z`). See the baseline/path-decision document for full disposability proof. No credential values appear in this document.

## Execution 1 — apply all pending migrations (upgrade path, real production-forked data)

This branch is a full fork of production (1.19GB, 640 tables, 12 real redraft seasons / 48 real rosters / 11 real trade proposals prior to any change) — not an empty database. The test performed is therefore the **upgrade case**: applying newer migrations on top of a real, populated, production-shaped schema state, which is the actual deployment scenario this program cares about.

```
npx prisma migrate deploy
```

Result: **all 7 pending migrations applied successfully, zero errors, zero warnings.**

```
Applying migration `20260706000000_add_replay_framework`
Applying migration `20260708000000_decision_os_imported_activity`
Applying migration `20260708010000_decision_os_behavioral_snapshot`
Applying migration `20260709000000_decision_os_league_context`
Applying migration `20260711110000_add_trade_execution_snapshots`
Applying migration `20260711120000_create_redraft_renewal_foundation`
Applying migration `20260711121000_extend_redraft_renewal_for_franchises`
All migrations have been successfully applied.
```

Post-apply verification: `npx prisma migrate status` → **"Database schema is up to date!"** `npx prisma validate` → **schema valid**.

## Execution 2 — a real defect found during physical validation, and its fix

Executing a real settlement + real reversal against this database (see the Gate C Physical Validation Report for the full sequence) surfaced a genuine, previously-undetected defect: `redraft_trade_proposals`'s `status` check constraint (defined in the much older `20260408195500_redraft_trade_playoff_core` migration) never included `'reversed'` as an allowed value, even though the already-shipped `tradeReversalService.ts` writes exactly that value on a completed reversal. Every real reversal attempt of a native redraft trade failed at the database layer with Postgres error `23514` (check violation) — invisible to any source-code review, type check, or mocked test, and only surfaced by running the real code against a real database.

**The failure was atomically safe**: verified directly that the failed reversal attempt left the trade proposal's status unchanged (`accepted`, not corrupted) and created zero `trade_reversals` rows — Prisma's serializable interactive transaction rolled back cleanly on the constraint violation.

**Fix**: a new, additive migration, `20260711130000_widen_redraft_trade_proposal_status_check`, drops and re-adds the check constraint with `'reversed'` added to the allowed list. No table, column, or type is dropped; no existing allowed value is removed. This migration does not touch `league_renewals`/`league_renewal_slots` or any other renewal object.

```
npx prisma migrate deploy
Applying migration `20260711130000_widen_redraft_trade_proposal_status_check`
All migrations have been successfully applied.
```

Re-running the same real reversal against the same real trade after this fix: **succeeded** — player ownership restored, proposal status correctly became `reversed`, a real `transaction.trade.reversed` `DomainEvent` row was created, a real `trade_reversed` `LeagueAuditLog` row was created, and a second identical reversal call correctly returned the existing reversal (`idempotent: true`) without creating a duplicate `TradeReversal` row (verified count remained exactly 1).

## Empty-database ("from scratch") case — not performed, disclosed honestly

Given the available disposable branch is a full production fork (deliberately provisioned that way, matching this program's stated intent to validate against realistic data), a separate from-empty-database migration run was not performed this phase. This is a real scope limitation, not a claim of completeness — the upgrade-path result above is the more representative and higher-value test for a database that will never actually start empty in production, but a from-scratch apply on a genuinely empty branch remains a reasonable follow-up if a second disposable branch is provisioned.

## Manual database edits

None. No row, constraint, or schema object was manually edited to force a migration to "succeed." The one real failure (the status-check defect) was fixed by writing a corrected migration file and re-running the full `migrate deploy` from that file, exactly as the guardrail requires.
