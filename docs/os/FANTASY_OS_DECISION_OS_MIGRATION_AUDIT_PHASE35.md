# Decision OS Migration Audit (Phase 35, Track A)

## Was a migration written? Yes, all three, real and complete.

| Migration | File | Content |
|---|---|---|
| `20260708000000_decision_os_imported_activity` | `prisma/migrations/20260708000000_decision_os_imported_activity/migration.sql` | `CREATE TABLE decision_os_imported_activity` + 3 indexes, purely additive |
| `20260708010000_decision_os_behavioral_snapshot` | `prisma/migrations/20260708010000_decision_os_behavioral_snapshot/migration.sql` | `CREATE TABLE decision_os_behavioral_snapshot` + 2 indexes, purely additive |
| `20260709000000_decision_os_league_context` | `prisma/migrations/20260709000000_decision_os_league_context/migration.sql` | 3 `CREATE TYPE` (enums) + `CREATE TABLE decision_os_league_context` + 1 index, purely additive |

Each file's own header explicitly states: **"Apply to a NON-PRODUCTION database only (Neon branch or local dev). Never to production."** — these were deliberately written as opt-in, manually-applied migrations, not part of the automatic `prisma migrate deploy` pipeline.

## Was it applied? No — confirmed via the database's own migration ledger, not inference.

Direct query of `.env.test`'s `_prisma_migrations` table returned **zero rows** matching any Decision OS migration name, before this phase's fix. This is authoritative: Prisma's own bookkeeping confirmed these three migrations had never run against this database.

## Root cause: found, not guessed

`.env.test`'s `_prisma_migrations` table contains **three unrelated, pre-existing failed/rolled-back migrations**, all from May 2026 and unrelated to Decision OS:

| Migration | Failed on | Rolled back |
|---|---|---|
| `20260507180000_world_cup_bracket_entries` | `column p.challengeId does not exist` | 2026-05-08 |
| `20260509170000_create_league_rank_invite_foundation` | `column "bypassRankGate" already exists` | 2026-05-09 |
| `20260516030000_world_cup_official_fixtures_standings` | `relation "world_cup_group_teams" already exists` | 2026-05-16 |

Prisma's own documented behavior: **"New migrations cannot be applied before the error is recovered from"** — meaning `prisma migrate deploy`/`migrate dev` refuses to apply any subsequent migration (including the Decision OS ones, dated after these failures) until each failed migration is explicitly resolved via `prisma migrate resolve`. Some later migrations (e.g. `20260705010000_add_trade_learning_live_capture`) DID successfully apply after these failures — meaning they must have been applied via a path that bypasses the blocked `migrate deploy` history check (e.g. `prisma db execute`, matching this phase's own successful application method), not via the standard pipeline. The three Decision OS migrations, combined with their own "apply manually" instruction, appear to have simply never received that manual step for this specific database.

## Was it removed or renamed? No.

The migration folders and SQL files are present, complete, and unmodified — this is not a case of an abandoned or reverted feature. This is confirmed unapplied-migration drift, not intentional divergence or code drift.

## Conclusion

**Environment/migration drift** — a real migration exists, was written correctly, was deliberately scoped to "non-production only" application, and was simply never executed against this particular non-prod database, compounded by an unrelated blocked migration-history chain that would have prevented the standard automated pipeline from reaching it anyway.
