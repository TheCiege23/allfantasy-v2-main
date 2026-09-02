# `af_projection_ros` — rest-of-season projection columns

**Status: APPLIED.** In the live `prisma/migrations/` directory. Both columns were verified
present in production on 2026-09-02 via `information_schema` — `rosProjection` double precision
nullable, `rosWeeksRemaining` integer nullable — and the code in this commit reads them.

⚠ This line previously read **"Status: PARKED. Not in the deploy path. Nothing reads these columns
yet."** All three claims were false by the time they were committed. Recorded rather than silently
replaced, because it reproduced the trap called out below about `20260831_tournament_grants`: a
header asserting a migration's state is a claim about the DATABASE, and only the database settles
it.

## What it does

Adds two nullable columns to `AFProjectionSnapshot`:

| column | type | meaning |
|---|---|---|
| `rosProjection` | `DOUBLE PRECISION` | Rest-of-season projected points. `NULL` = not computed. |
| `rosWeeksRemaining` | `INTEGER` | Weeks that total covers, as known at `computedAt`. |

## Why

`afProjection` is **per game**; the trade-value engine expects a **rest-of-season total**. Feeding
one to the other understates every player by ~17× — and silently, because every wrong value is a
plausible number:

```
elite WR, 19.5/game   →   532 wrong    9050 right
RB1,      18.0/game   →   538 wrong    9149 right
```

Storing both units means the conversion happens once, at write time, where `weeksRemaining` is
actually known — rather than being re-derived at each read site, where the first one to get it
wrong produces a believable number.

## Cost

Catalog-only. Both columns are nullable with no default, so PostgreSQL 11+ does **no table
rewrite and no backfill** however large the table is. The `ACCESS EXCLUSIVE` lock is held only for
the catalog update.

There is deliberately **no backfill**. Existing rows have no rest-of-season value, and `NULL`
("not computed") is the truthful state. A `DEFAULT 0` would assert those players are worth
nothing.

## Order of operations — this one matters

1. **Apply this SQL.**
2. Add the two fields to `prisma/schema.prisma` (block below).
3. `npx prisma generate`.
4. *Then* ship code that reads or writes them.

Reversing 1 and 4 raises **P2022** on every read of `AFProjectionSnapshot` — a generated client
that knows about a column production lacks does not degrade, it throws.

## Schema block to add

Inside `model AFProjectionSnapshot`, after `afProjection`:

```prisma
  /// Rest-of-season projected points. NULL = not computed — readers must fall back, never treat
  /// as 0. ⚠ DIFFERENT UNIT from `afProjection`, which is PER GAME.
  rosProjection      Float?
  /// Weeks `rosProjection` covers, as known at `computedAt`. Makes the total auditable and tells
  /// a low projection apart from a late-season one.
  rosWeeksRemaining  Int?
```

## Applying it — already done, and what remains

The columns exist in production. Nothing needs running for this migration's EFFECT.

What may still be outstanding is Prisma's own bookkeeping: if the columns were added by hand rather
than through `migrate deploy`, `_prisma_migrations` holds no row for this directory. That is why
the SQL is `ADD COLUMN IF NOT EXISTS` — a later `migrate deploy` then records it cleanly instead of
failing with "column already exists", which would write a `finished_at IS NULL` row and block
**every** subsequent deploy with P3009.

```bash
ALLOW_PROD_MIGRATION=1 npm run db:migrate:deploy:prod
```

🛑 **Before running that, check what else is in `prisma/migrations/`.** That command applies
**every** pending migration in the directory, not just this one.

⚠ **And do not trust a migration's own header about whether it was applied.**
`prisma/migrations/20260831_tournament_grants/` sits in that directory carrying a "PARKED, NOT
APPLIED" header while `_prisma_migrations` records it applied **2026-08-31 17:26:39**. It was
briefly moved out of the deploy path on the strength of that comment and put straight back when the
query contradicted it. Query `_prisma_migrations`; do not read a comment.

## Rollback

`ROLLBACK.sql` in this directory. Roll the **code** back first — see the note in that file.
