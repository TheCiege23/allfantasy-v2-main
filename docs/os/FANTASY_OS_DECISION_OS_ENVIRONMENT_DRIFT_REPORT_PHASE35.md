# Decision OS Environment Drift Report (Phase 35, Track A)

## Comparison

| Layer | State (before this phase) | State (after this phase) |
|---|---|---|
| `prisma/schema.prisma` (expected schema) | Defines all 3 models correctly | Unchanged (was always correct) |
| Migration history (repo files) | All 3 migration files present, correct, unapplied | Unchanged (files not modified — only executed) |
| `.env.test` actual database | 3 tables missing; `_prisma_migrations` had 0 Decision OS entries | 3 tables present (0 rows each); `_prisma_migrations` now has all 3 entries, marked applied |
| `.env` (default shared DB) | Already had `decision_os_imported_activity` (discovered incidentally — see below) | Unchanged, not touched this phase |

## Classification: migration drift (not environment, code, or intentional divergence)

- **Not environment drift** in the "wrong config pointed at wrong place" sense — `.env.test`'s `DATABASE_URL`/`DIRECT_URL` correctly point to its own dedicated Neon database (`ep-muddy-leaf-adigvvph`), distinct from `.env`'s (`ep-spring-tooth-adaoi9x1`) and `.env.local`'s (`ep-curly-block-ad0dlt9o`) — three genuinely separate databases, each behaving consistently with its own real migration history.
- **Not code drift** — `prisma/schema.prisma` and the real application code were never out of sync with each other; the code correctly expected these tables to exist per the schema, and correctly degraded (caught real Prisma errors non-fatally) when they didn't.
- **Is migration drift** — the gap was purely "migration written, not yet run against this specific database," a normal and expected state for a migration explicitly marked "apply manually to non-prod only," compounded by an unrelated blocked migration chain (see Migration Audit) that would have silently prevented the standard `migrate deploy` pipeline from ever reaching these three migrations even if someone had tried.

## An incidental finding worth flagging: `.env`'s database already had `decision_os_imported_activity`

While diagnosing which database a misconfigured `prisma db execute` command hit (see the Impact Assessment / Final Report for the full incident), this phase discovered `.env`'s own default database already has a table named `decision_os_imported_activity` — meaning the default shared environment used elsewhere in this whole effort is NOT in the same missing-schema state as `.env.test`. This wasn't independently confirmed for the other two tables, and no data in `.env` was touched or altered this phase (the mistaken command failed atomically on "already exists," a no-op). Flagged for awareness: `.env.test` and `.env` may have diverged from each other for reasons beyond this phase's investigation (e.g. `.env` may have received a manual migration run this phase never traced) — worth a future, dedicated cross-environment migration audit if that matters for release planning.
