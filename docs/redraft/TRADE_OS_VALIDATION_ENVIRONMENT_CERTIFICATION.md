# Trade OS Validation Environment Certification

Date: 2026-07-11

## Outcome

**FAIL — safe to mutate: NO.**

The database is positively associated with the approved Neon project, but its branch name, parent branch, creation timestamp, clone status, and disposable/non-production designation cannot be proven from the available read-only evidence. No migration, schema change, fixture, or Trade OS test was executed.

## Verified identity

- Neon project: `icy-field-51189449`
- Endpoint: `ep-polished-hat-adlrp09z`
- Branch ID: `br-green-lab-admi6kkj`
- Branch name: not discoverable from SQL
- Parent branch: not discoverable from SQL
- Clone status: unproven
- Creation timestamp: unavailable
- Disposable/non-production designation: unproven
- Database: `mydb_shadow`
- Schema: `public`
- PostgreSQL version: `17.10 (986efc8)`
- Current user: `neondb_owner`

The project, branch, and endpoint IDs were returned directly by PostgreSQL settings `neon.project_id`, `neon.branch_id`, and `neon.endpoint_id` during a read-only transaction.

## Migration evidence

The database `_prisma_migrations` table contains exactly one completed, non-rolled-back row:

- `20260407024117_init`, started `2026-04-07T02:49:40.731Z`, completed `2026-04-07T02:49:45.229Z`

The repository currently contains 114 migration directories, from `20260407024117_init` through `20260711121000_extend_redraft_renewal_for_franchises`. The independent trade-evidence migration is `20260711110000_add_trade_execution_snapshots` and is not recorded as applied. Neither `trade_execution_snapshots` nor `trade_reversals` currently exists.

The single database migration proves only that initialization ran. It does not prove whether the branch was freshly created, cloned from a parent whose selected database had only the initial migration, or created from a historical restore point. Explaining the cause requires Neon control-plane metadata for branch name, parent ID, creation time, and branch point; SQL alone cannot establish those facts.

## Risk assessment

The project ID matches the expected project, but that is insufficient authorization to mutate a branch. The parent branch and disposable status are mandatory stop gates. The large difference between database-applied history and repository source history also means this is not demonstrated to be a live-equivalent clone of the expected validation baseline.

Required evidence before reconsidering the gate:

- Neon control-plane confirmation that `br-green-lab-admi6kkj` has the approved validation branch name.
- Parent branch confirmation matching the approved parent.
- Branch creation timestamp and branch-point/clone metadata.
- Explicit disposable/non-production designation.
- Explanation of the one-row migration history, or corrected credentials for a branch carrying the intended cloned history.

## Commands and safety

The certification used a Node PostgreSQL client with only `.env.trade-validation`, opened `BEGIN READ ONLY`, queried identity/settings and `_prisma_migrations`, and issued `ROLLBACK`. Local migration directory names were listed separately. Prisma, migration application, seeds, tests, and database writes were not run. Credentials were not printed.
