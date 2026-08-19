# Redraft Renewal Migration Recovery Plan

## Verified mismatch

On 2026-07-11 the configured Neon PostgreSQL database (`neondb`, `public`) contained 117 migration records while source contained 111 migration directories. The last common migration was `20260708010000_decision_os_behavioral_snapshot`. One source migration was unapplied and four applied database migrations were absent from source. Three older records were explicitly rolled back; no unfinished migration was found. Neither renewal table existed and no database migration record named a renewal migration was present. The exact cause remains unknown. Plausible causes must not be treated as fact until repository history and deployment records are reconciled.

The configured URL and Prisma both identify the same Neon database. Server address reporting through the connection path is not evidence of a different database. Because migration histories diverge, this database is inspection-only for this recovery phase.

## Stage 1

`20260711120000_create_redraft_renewal_foundation` creates the two mapped enums, `league_renewals`, `league_renewal_slots`, primary keys, the cascading renewal relations, current defaults, manager-scoped uniqueness, renewal-per-league-season uniqueness, and current indexes. It deliberately does not use `IF NOT EXISTS`: conflicting objects must fail visibly. It performs no season, roster, summary, or lifecycle writes.

## Stage 2

`20260711121000_extend_redraft_renewal_for_franchises` adds backward-compatible status values, nullable renewal lineage fields, nullable franchise and manager identity fields, confirmation and invitation linkage, a transitional nullable `(renewalId, franchiseId)` unique index, unique `nextSeasonId`, and unique active redraft-season identity. Existing manager uniqueness remains during transition.

`LeagueTeam.id` is the bounded persistent franchise identity. A roster remains season-scoped; historical summaries and prior manager display values are not modified.

## Data preflights and backfill

Immediately before Stage 2, run the duplicate query below. The 2026-07-11 configured-database result was zero.

```sql
SELECT "leagueId", season, COUNT(*)
FROM redraft_seasons GROUP BY "leagueId", season HAVING COUNT(*) > 1;
```

Backfill assigns a franchise only when a slot user maps to exactly one `league_teams` row in the same league through `platformUserId` or `claimedByUserId`. It preserves `userId`, copies it to `priorManagerId`, derives renewal intent only from the existing confirmed state, and uses `respondedAt` as `decisionAt`. Zero or multiple candidates remain null and must block later completion. The statement is retry-safe because it updates only null franchise identities.

After Stage 1 and before Stage 2, obtain production counts for renewals, slots, unmapped slots, multi-match slots, missing managers, orphaned renewals/slots, and duplicate candidates. Current live counts cannot be reported because the physical tables do not exist.

## Deployment order

1. Reconcile the four database-only migrations and the unapplied source migration.
2. Confirm the intended nonproduction Neon branch and create a restore point.
3. Re-run table, history, orphan, and duplicate preflights.
4. Apply Stage 1 to a disposable live-equivalent database.
5. Inspect tables, columns, enums, constraints, indexes, and Prisma status.
6. Run renewal opening, manager decision, lifecycle, audit, outbox, and legacy-route regressions.
7. Apply Stage 2 and run the deterministic backfill.
8. Record unresolved rows and verify active-season uniqueness physically.
9. Deploy franchise-aware writes only after Stage 2 succeeds.
10. Keep commissioner confirmation and next-season creation disabled until every gate passes.

## Verification queries

Inspect `information_schema.tables`, `information_schema.columns`, `pg_type`, `pg_enum`, `pg_constraint`, `pg_indexes`, and `_prisma_migrations`. Verify there are no unresolved active slots before any later non-null constraint. Verify `league_renewals_nextSeasonId_key`, `league_renewal_slots_renewalId_franchiseId_key`, and `redraft_seasons_leagueId_season_key` by name.

## Recovery and rollback

Before renewal writes, a failed Stage 1 may remove only objects it created after confirming no rows exist. Once rows exist, use forward repair. Stage 2 is additive; applications may temporarily ignore nullable fields. Do not drop populated extension columns as a normal rollback. Preserve backfill reports, correct missing indexes or constraints forward, and never mark a migration resolved until physical objects match reviewed SQL. Prisma prevents duplicate application through `_prisma_migrations`; manual resolution requires an evidence record and physical verification.

## Known limitations and gate

No shadow or disposable database validation has yet been completed. The configured database was not altered. Migration history is not clean, live renewal/backfill counts are unavailable, and database-backed concurrency is unproved. Atomic next-season creation, archive arbitration, replacement management, and week advancement remain blocked.

## Reconciliation result — 2026-07-11

The four database-only migrations could not be recovered from local history, fetched remotes, either authoritative GitHub repository, or exact-path commit history. Physical objects consistent with their names exist, but inferred SQL cannot reproduce authoritative checksums. Strategy B is selected for disposable-clone validation only. Until that clone is approved and provisioned, the deployment decision is Gate C — unsafe.
