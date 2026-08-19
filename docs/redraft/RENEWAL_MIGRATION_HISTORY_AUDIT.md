# Renewal Migration History Audit

## Migration chain state (real, measured against the disposable validation branch)

`npx prisma migrate status` against the disposable branch (a real fork of production, prior to any change this phase made) reported:

- **114 migrations found locally.** Last common migration with the database: `20260705010000_add_trade_learning_live_capture`.
- **7 local migrations not yet applied to the database fork**: `20260706000000_add_replay_framework`, `20260708000000_decision_os_imported_activity`, `20260708010000_decision_os_behavioral_snapshot`, `20260709000000_decision_os_league_context`, `20260711110000_add_trade_execution_snapshots`, `20260711120000_create_redraft_renewal_foundation`, `20260711121000_extend_redraft_renewal_for_franchises`.
- **4 migrations present in the database but absent from the local `prisma/migrations` directory**: `20260609010000_add_ai_billing_fields`, `20260610090000_add_fantasy_cache_contracts`, `20260610091000_add_concept_presets`, `20260610100000_expand_concept_presets`. This is a real, pre-existing, already-disclosed divergence (matches prior project history — see the implementation matrix's earlier "Migration reconciliation found four applied database migrations absent from both source remotes" note) — it predates and is unrelated to the renewal work, was not created by this phase, and was not modified this phase (migration history is explicitly out of scope to alter).

## Renewal migration content audit (direct read of both files)

**`20260711120000_create_redraft_renewal_foundation/migration.sql`** (40 lines): Creates two new enums (`league_renewal_status`, `league_renewal_slot_status`), two new tables (`league_renewals`, `league_renewal_slots`) with a foreign key to the existing `leagues` table, and 6 indexes. Deliberately omits `IF NOT EXISTS` (per its own comment) so an incompatible pre-existing object fails loudly rather than silently no-opping. Purely additive — confirmed via grep for `DROP\s+(TABLE|COLUMN|TYPE)` / `TRUNCATE`: zero matches.

**`20260711121000_extend_redraft_renewal_for_franchises/migration.sql`** (55 lines): Adds 9 new enum values across the two enums (`ALTER TYPE ... ADD VALUE`), adds 9 new nullable columns to `league_renewals`, adds 9 new columns to `league_renewal_slots` (one non-nullable with a default: `removedFromNextSeason BOOLEAN NOT NULL DEFAULT false`), adds 4 new indexes (including a unique index on `redraft_seasons(leagueId, season)` — see below), and ends with one guarded backfill `UPDATE` that only ever writes to its own newly-added, previously-`NULL` `franchiseId`/`priorManagerId`/`candidateManagerId`/`decisionAt` columns, restricted to rows with an exact one-to-one match between a renewal slot's `userId` and a `league_teams` row's `platformUserId`/`claimedByUserId` (a `CTE ... WHERE matches = 1` guard — ambiguous multi-match cases are explicitly skipped, not guessed). Also purely additive — same DROP/TRUNCATE grep, zero matches.

**Real risk identified and resolved by successful application, not by inspection alone**: `CREATE UNIQUE INDEX "redraft_seasons_leagueId_season_key" ON "redraft_seasons"("leagueId", "season")` (line 37) would fail if real production data contained any duplicate `(leagueId, season)` pair. This was not merely inspected — it was proven safe by successfully applying the migration to the real production-forked branch (see the Execution Report): the index was created without error, meaning the real data has zero duplicates for this key.

## Tables of interest — presence and shape after full deploy

Verified via direct query against the disposable branch after all 7 pending migrations applied: `redraft_seasons` (12 real rows, 10 NFL + 2 NCAAF), `redraft_rosters` (48 real rows), `redraft_trade_proposals` (11 real rows), `trade_execution_snapshots` (0 rows — expected, the table was just created), `trade_reversals` (0 rows — expected, same reason). `league_renewals`/`league_renewal_slots` exist with the full column set from both migrations.

## Rollback/recovery documentation

Neither renewal migration includes an explicit down-migration or documented manual-recovery procedure (consistent with the rest of this migration directory — Prisma's forward-only migration model is used throughout this project, not per-migration rollback scripts). This is a pre-existing project convention, not a gap introduced or found by this specific migration pair.

## Conclusion

Both renewal migrations are correctly additive, apply cleanly against a real, full, production-forked database (confirmed by execution, not inference), and their one meaningful data-dependent risk (the new unique index) was proven safe against real data. The pre-existing 4-migration/source-history divergence is real but unrelated and out of this phase's scope to fix.
