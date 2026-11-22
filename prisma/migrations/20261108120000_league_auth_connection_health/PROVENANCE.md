# `20261108120000_league_auth_connection_health` — applied to production 2026-11-08

**Applied and recorded.** It was applied on the owner's instruction ("Apply it", 2026-11-08) to the Neon project `All Fantasy`, branch `production` (`br-twilight-waterfall-adhk83g2`, endpoint `ep-curly-block-…`). `migrate deploy` matches the recorded checksum and skips it.

| step | detail |
|---|---|
| before | `league_auths` had 11 rows and none of the five columns. No ledger row for this name. No unfinished migrations. |
| applied | one `ALTER TABLE "league_auths" ADD COLUMN IF NOT EXISTS …` carrying the five columns in this file |
| verified | all five present: `text` / `timestamp(3)`, nullable, no default |
| recorded | `_prisma_migrations` row, `finished_at` 2026-11-08 18:28:55Z, `applied_steps_count` 1 |
| checksum | `de33c10c039398c27fd8a922c759afa56999cc72653bc3e4637734d25b6e30b6`: sha256 of this `migration.sql` as committed (LF, 1941 bytes, zero CR) |

## ⚠ Do not edit `migration.sql`

The file's header still says *"WRITTEN, NOT APPLIED"*, which was true when it was written in `prisma/migrations-pending/`. **It is left unchanged on purpose.** Prisma's checksum is a plain sha256 of these bytes, so correcting the comment would make the file disagree with the ledger. A later `migrate deploy` would then report the migration as modified after it was applied. This file is where its current state is recorded instead.

## Order kept

The header's rule — apply first, then land the code that reads the columns — was followed:
1. The columns were applied and verified.
2. Only then was the commit carrying the `schema.prisma` fields and their readers opened for review.
