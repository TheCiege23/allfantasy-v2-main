# `af_projection_ros` — rest-of-season projection columns

**Status: PARKED.** Not in the deploy path. Nothing reads these columns yet.

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

## To apply

```bash
ALLOW_PROD_MIGRATION=1 npm run db:migrate:deploy:prod
```

🛑 **Before running that, check what else is in `prisma/migrations/`.** That command applies
**every** pending migration in the directory, not just this one. As of writing,
`prisma/migrations/20260831_tournament_grants/` is sitting there — untracked, and its own header
says it was meant to be parked here. Confirm you intend to apply that too, or move it, first.

## Rollback

`ROLLBACK.sql` in this directory. Roll the **code** back first — see the note in that file.
