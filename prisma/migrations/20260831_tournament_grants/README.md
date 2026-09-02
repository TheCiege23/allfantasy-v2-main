# Tournament access grants

**Applied to production on 31 August 2026** and recorded in `_prisma_migrations`
via `prisma migrate resolve --applied`.

This folder was written in `prisma/migrations-pending/` and moved here once it had
actually been applied. That order was deliberate: `prisma migrate deploy` reads
the *directory*, not git, so a migration sitting in `prisma/migrations/` is
applied by whoever next runs it — intended or not.

## What it adds

`tournament_shell_grants` — who besides the commissioner can see and act on a
tournament. A tournament otherwise has exactly one empowered person
(`TournamentShell.commissionerId`), so there is no way to let a co-commissioner
look without handing them the whole tournament.

Every grant includes read; the three capability columns are additive and default
to false, because the rule being implemented is that a co-commissioner has access
and changes nothing until each capability is given explicitly.

## ⚠ Still to do when the permission screen is built

The table exists. The Prisma model does **not** — nothing in the client knows
about it yet, which is why no code can read it. Add this to
`prisma/schema.prisma` and run `prisma generate` at that point, not before:
regenerating rewrites the client that every session sharing this checkout uses,
and there is nothing to gain from doing it early.

```prisma
/// Who besides the commissioner can see and act on a tournament.
model TournamentGrant {
  id              String          @id @default(cuid())
  tournamentId    String
  /// The AppUser being granted access. A grant needs an account to point at.
  userId          String
  /// Human label only — the booleans below are what is enforced.
  role            String          @default("viewer") @db.VarChar(32)
  /// Every grant includes read. These are additive, and each defaults to false.
  canBroadcast    Boolean         @default(false)
  canAdvance      Boolean         @default(false)
  canEditSettings Boolean         @default(false)
  grantedByUserId String
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
  tournament      TournamentShell @relation(fields: [tournamentId], references: [id], onDelete: Cascade)

  @@unique([tournamentId, userId])
  @@index([tournamentId])
  @@index([userId])
  @@map("tournament_shell_grants")
}
```

And on `TournamentShell`, the back-relation:

```prisma
  grants TournamentGrant[]
```

⚠ The columns above must match the SQL in this folder exactly. They were applied
from that file, not generated from this model, so the two can drift — and Prisma
will not tell you: a mismatch surfaces as a query error at runtime, not at
generate time.

## The rules are already written

`lib/tournament/tournamentPermissions.ts` holds the capability logic as pure
functions with tests, reading no database. Wiring it to this table is the step
that was waiting on the migration.
