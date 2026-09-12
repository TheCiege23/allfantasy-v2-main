# `20260830190000_devy_head_coach_context` — applied to production, never committed

This migration **is already applied to production** (2026-08-31 04:51:19 UTC,
`applied_steps_count = 1`). It is filed here rather than in `prisma/migrations/`
because this directory is outside the deploy path — see the README one level up.
Nothing about this file changes the database.

## Why it was missing

It was written on a branch that never landed: `5c87dd8b5`,
*"feat(devy): ingest head coaches and season-total PPA — HELD, NEEDS MIGRATION"*,
2026-08-31 00:32. The migration was applied to prod 4h19m later; the branch was
not merged. `migration.sql` here is that commit's blob, restored unmodified.

## ⚠ The committed bytes do NOT hash to production's recorded checksum

Prisma's `_prisma_migrations.checksum` is a plain sha256 of the `migration.sql`
bytes. This repo stores `.sql` with **LF** (`core.autocrlf=true`, and every
existing `migration.sql` blob on `main` contains zero CR bytes), but the file was
applied from a Windows working tree, so production recorded the **CRLF** digest:

```
LF   (what is committed here)  f06fd2fa23b5caeca17ffb0f80e75776ede7456907b6ab4fea0bf8e06ba84508
CRLF (what prod recorded)      ed157f6d5eab26581540f1715ba0ae8c57edf838ecc4d8a4ac37c48b0cd0270d
```

Both are the same SQL. The LF form is committed because it matches the repo's
convention and the original commit; the CRLF digest is recorded here so the
mismatch is expected rather than alarming.

🛑 **Consequence if this is ever moved into `prisma/migrations/`:** `prisma
migrate deploy` will report a checksum mismatch for a migration that is in fact
correctly applied. Do not "fix" that by re-running it — the columns already
exist. Resolve the discrepancy deliberately, or leave the file here.

## What it did

Six additive columns on `DevyPlayer`, all six verified present in production and
all present in `prisma/schema.prisma`:

`headCoachSeason`, `headCoachName`, `headCoachHireDate`, `headCoachChanged`,
`teamSpOffense`, `ppaSeasonTotal`.
