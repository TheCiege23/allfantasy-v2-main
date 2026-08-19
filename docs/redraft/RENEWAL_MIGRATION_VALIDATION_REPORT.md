# Renewal Migration Validation Report

## Validation environment

Repository validation ran locally against the resolved worktree path. The configured Neon PostgreSQL 17.10 database was used only for read-only identity, history, and physical-schema inspection. No disposable Neon branch, shadow database, or PostgreSQL clone was provisioned, so neither recovery migration was applied.

## History reconciliation

Four successful database migrations are absent from both source repositories and could not be recovered exactly. Their physical effects appear present and corresponding Prisma models exist, but checksums cannot be reproduced without authoritative SQL. One later source migration is pending and its objects are absent. Rolled-back records have later successful, source-matching counterparts. See `MIGRATION_HISTORY_RECONCILIATION.md`.

Selected approach: Strategy B, pending an approved disposable clone. Exact production checksum parity is not restored.

## Pre-migration physical baseline

- Renewal tables: absent.
- Renewal enums: absent based on prior inspection.
- Duplicate active redraft-season identities: zero.
- Conflicting renewal objects: none observed.
- Stage 1 and Stage 2: pending by definition; not applied.
- Configured migration status: divergent before the two recovery migrations, with one pre-existing source migration pending.

## Stage 1 result

Application command: not run.

SQL contract and Prisma schema validation passed locally. Physical objects, constraints, cascade behavior, runtime writes, audits, outbox events, lifecycle state, and failure paths remain unverified against PostgreSQL.

## Stage 2 result

Application command: not run.

The additive SQL contains the intended nullable fields, enum additions, transitional unique indexes, deterministic backfill, and active redraft-season uniqueness. Physical fields, constraints, enum values, and runtime compatibility remain unverified against PostgreSQL.

## Backfill

The renewal tables do not exist in the inspected database, so production-equivalent counts cannot be queried. No fixture totals are substituted.

| Metric | Result |
|---|---:|
| Renewals | unavailable |
| Slots | unavailable |
| Mapped | unavailable |
| Unmapped | unavailable |
| Ambiguous | unavailable |
| Orphaned | unavailable |
| Duplicate candidates | unavailable |
| Rows receiving prior manager | unavailable |
| Rows receiving candidate manager | unavailable |
| Second-run changes | unverified |

## Runtime regressions

Local validation previously passed four focused files and 26 tests using one worker. Database-backed opening, decisions, retry behavior, audits, outbox, lifecycle, unresolved-row blocking, and uniqueness collisions were not run.

## Prisma status

- `prisma validate`: passed.
- Configured database migration status: divergent.
- Failed unfinished migrations: none.
- Rolled-back historical attempts: three, each later superseded or resolved.
- Pending source migrations: the pre-existing league-context migration plus both new renewal migrations.

## Failure-path evidence

Static contracts prove neither recovery migration contains a destructive drop. No physical conflict, retry, duplicate-season, interrupted-backfill, or partial-application test was performed without a disposable database.

## Production recommendation

**Gate C — unsafe.** Do not deploy either migration or proceed to next-season creation. Provision an approved disposable clone carrying the physical schema and `_prisma_migrations`, establish a validation-only baseline, apply Stage 1 and Stage 2 separately, and capture physical/runtime evidence. Even successful clone validation would leave production history unresolved until an owner and database administrator approve a reconciliation path.

## Disposable branch provisioning attempt — 2026-07-11

Provisioning could not proceed. The repository variable exposes Neon project `icy-field-51189449`, and read-only SQL identifies parent branch `br-restless-unit-adhut4n4` and endpoint `ep-spring-tooth-adaoi9x1`. `NEON_API_KEY` exists as a GitHub secret in both configured repositories, but secret values are intentionally unavailable to this session. No authenticated local Neon profile or installed CLI exists. The current workflow supports pull-request events only and cannot be safely invoked as an ad hoc validation provisioner. No branch was created and the configured database remained untouched.

Owner action required: create `redraft-renewal-migration-validation-20260711` in project `icy-field-51189449` from parent `br-restless-unit-adhut4n4`, then provide the disposable pooled and direct URLs through ephemeral `RENEWAL_MIGRATION_VALIDATION_DATABASE_URL` and `RENEWAL_MIGRATION_VALIDATION_DIRECT_URL` variables. Do not replace persistent `DATABASE_URL`.
