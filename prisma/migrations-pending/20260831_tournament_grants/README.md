# Tournament access grants — parked migration

**Status: NOT APPLIED. NOT in `prisma/migrations/` on purpose.**

`prisma migrate deploy` reads the *directory*, not git history — anything left in
`prisma/migrations/` rides along on the next person's deploy, whoever they are.
This stays here until the user decides to apply it.

## Order of operations, and it matters

1. Apply `migration.sql`.
2. Add the model below to `prisma/schema.prisma` and run `prisma generate`.
3. Only then ship code that reads `prisma.tournamentGrant`.

Doing 3 before 1 does **not** no-op: a generated client that knows about a table
production lacks raises **P2021**, and a missing column raises **P2022**.

## Why the schema block is not already applied here

`prisma/schema.prisma` was dirty in the shared checkout when this was written —
carrying another session's `prisma format` pass plus real model changes of their
own. Editing and committing it would have swept their uncommitted work into an
unrelated commit, and could have shipped code referencing columns that do not
exist in production yet. Whoever owns that file's current state should paste this
in.

```prisma
/// Who besides the commissioner can see and act on a tournament.
///
/// A tournament otherwise has exactly one empowered person —
/// `TournamentShell.commissionerId` — so there is no way to let a
/// co-commissioner look without handing them the whole tournament.
model TournamentGrant {
  id              String          @id @default(cuid())
  tournamentId    String
  /// The AppUser being granted access. A grant needs an account to point at.
  userId          String
  /// Human label only — the booleans below are what is enforced.
  role            String          @default("viewer") @db.VarChar(32)
  /// Every grant includes read. These are additive, and each defaults to false:
  /// a co-commissioner has access and changes nothing until told otherwise.
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

And on `TournamentShell`, add the back-relation:

```prisma
  grants TournamentGrant[]
```

## What is already built against it

`lib/tournament/tournamentPermissions.ts` holds the capability rules as pure
functions with tests — no database access, so it is safe to ship now. Wiring it
to this table is the step that waits for the migration.
