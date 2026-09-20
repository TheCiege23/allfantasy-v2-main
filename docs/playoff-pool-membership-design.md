# Playoff pool membership — design, pending approval

**Status:** proposed. Nothing here is built. It needs a **migration**, and applying one to
production is the owner's decision, so this is written to be approved or rejected first.

Companion to `docs/playoff-provider-suitability.md` and the audit in the
`playoff-bracket-mlb-gaps` memory note.

---

## What is actually broken

`lib/playoffs/*` stores six pool settings and enforces none of them. Two of the six —
`maxParticipants` and `maxEntriesPerParticipant` — were plain numbers and are now enforced
(they needed no new state). The remaining four cannot be enforced as the data stands:

| setting | where it lives | why it cannot be enforced today |
|---|---|---|
| `visibility: private` | base config | nothing records **who is allowed in** |
| `approvalRequired` | `afCommissioner.privacy` | nothing records a **pending** request |
| `passwordProtected` | `afCommissioner.privacy` | **no password is stored anywhere** |
| `hidePicksUntilLock` | `afCommissioner.privacy` | needs a membership/role read to decide who is exempt |

Two further facts that shape the design:

1. **The invite code is not a secret.**
   ```ts
   function toInviteCode(challengeId: string): string {
     return challengeId.slice(0, 8).toUpperCase()
   }
   ```
   It is derived from the challenge id, which is already in the pool URL. Anyone who can
   reach the pool can compute its invite code. **Any scheme that gates on this code gates on
   nothing.** A real invite needs its own random secret.

2. **The three `afCommissioner.privacy` flags are feature toggles, not values.** They are
   booleans meaning "this pool may use the feature", forced false unless the owner is an AF
   Commissioner subscriber. `passwordProtected: true` does not imply a password exists —
   there is nowhere to put one.

## The hole, stated plainly

Any signed-in user holding a pool id can create an entry in a pool marked private, up to the
participant cap. There is no join step to refuse them.

---

## Proposed shape

### 1. A membership table

```prisma
model PlayoffBracketMember {
  id          String   @id @default(cuid())
  challengeId String   @map("challenge_id")
  userId      String   @map("user_id")
  role        String   @default("member")   // owner | co_commissioner | member
  status      String   @default("active")   // active | pending | removed
  invitedBy   String?  @map("invited_by")
  joinedAt    DateTime?@map("joined_at")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  challenge PlayoffBracketChallenge @relation(fields: [challengeId], references: [id], onDelete: Cascade)
  user      AppUser                 @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([challengeId, userId])
  @@index([challengeId, status])
  @@map("playoff_bracket_members")
}
```

**Backfill is required and is the risky part.** 26 pools and 23 entries exist in production.
Every distinct `(challengeId, userId)` with an entry must become an `active` member in the
same migration, and the pool owner must become `role: owner` even with no entry. Shipping the
gate without the backfill locks every existing participant out of their own pool.

⚠ The committed migration for these tables already disagrees with production —
`20260511110000_playoff_brackets_nba_nhl` creates camelCase columns where production holds
snake_case. A new migration must follow the **production** shape (snake_case, matching the
Prisma `@map`s), not the committed one.

### 2. A real invite secret

Replace `toInviteCode` with a stored random token on the challenge (or on an invite row, if
multi-use/expiring invites are wanted later). The derived code must stop being treated as an
invite — it can remain a human-readable pool reference if something displays it, but nothing
may gate on it.

### 3. Join, as one gate

A single `joinPlayoffPool` in the service, with the API route folded into the existing
challenge route rather than a new one (`no-new-routes-combine-into-existing`):

- **public** → join creates an `active` member
- **private** → requires a valid invite token, else refuse
- **passwordProtected** → requires the password, compared against a **hash**
- **approvalRequired** → creates a `pending` member; the owner approves
- caps are re-checked here, inside the same transaction as the insert

`createPlayoffBracketEntry` then requires an `active` membership rather than merely a session.

### 4. `hidePicksUntilLock`

With roles available this becomes readable: before lock, a member sees only their own picks;
the owner and co-commissioners see all. This is the one flag that costs almost nothing once
the table exists.

---

## The password is the part to be most careful about

A join password is a credential. It must be **hashed** (the codebase already uses a
`passwordHash` column elsewhere), never stored in the `config` JSON blob, never returned by
any view, and never logged. If that is more than this feature warrants, **drop
`passwordProtected` from scope** and keep invite-token + approval, which cover the same
intent without holding a secret.

That is a genuine option, and the smaller one.

---

## Decisions needed before any code

1. **Migration + backfill** — approve applying a new table and backfilling 26 pools?
2. **Password** — implement it hashed, or drop `passwordProtected` and rely on invite +
   approval?
3. **Co-commissioners** — in scope now, or `role` reserved and unused for the moment?
4. **Sequencing** — land the table and backfill first and gate in a later change, or gate in
   the same one? Gating in the same change means the code cannot ship until the migration is
   applied.

## What is NOT proposed

Changing anything about `lib/brackets/*` (the legacy NCAA stack) or the World Cup stack. The
World Cup view already resolves entries per-viewer correctly and has its own participant
model; this is scoped to `lib/playoffs/*`.
