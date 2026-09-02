-- Tournament access grants: who besides the commissioner can see and do things.
--
-- 🛑 PARKED, NOT APPLIED. `prisma migrate deploy` reads a DIRECTORY rather than
-- git, so anything sitting in prisma/migrations/ rides along on the next
-- person's deploy. This lives in migrations-pending/ until the user decides to
-- apply it, and the code that reads this table must not ship before it exists —
-- a generated client that knows a column production lacks raises P2022.
--
-- WHY IT IS NEEDED: a tournament today has exactly one person who can do
-- anything — `TournamentShell.commissionerId`. There is no way to let a
-- co-commissioner look without also making them the commissioner, and no way to
-- let the person who runs one of the twenty leagues send a message to it.

CREATE TABLE "tournament_shell_grants" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    -- The AppUser being granted access. A grant needs an account to point at:
    -- a manager with no AllFantasy login cannot be given permissions here.
    "userId" TEXT NOT NULL,
    -- Human label only. The booleans below are what is actually enforced, so a
    -- role that drifts from them cannot silently widen anyone's access.
    "role" VARCHAR(32) NOT NULL DEFAULT 'viewer',
    -- ⚠ EVERY GRANT INCLUDES READ. The three capabilities are additive on top,
    -- and each defaults to FALSE: the user's rule is that a co-commissioner has
    -- access but changes nothing until it is given to them explicitly.
    "canBroadcast" BOOLEAN NOT NULL DEFAULT false,
    "canAdvance" BOOLEAN NOT NULL DEFAULT false,
    "canEditSettings" BOOLEAN NOT NULL DEFAULT false,
    "grantedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tournament_shell_grants_pkey" PRIMARY KEY ("id")
);

-- One grant per person per tournament: two rows would make "what can they do"
-- depend on which was read first.
CREATE UNIQUE INDEX "tournament_shell_grants_tournamentId_userId_key"
    ON "tournament_shell_grants"("tournamentId", "userId");

CREATE INDEX "tournament_shell_grants_tournamentId_idx"
    ON "tournament_shell_grants"("tournamentId");

-- Listing "tournaments I can see" is a per-user read.
CREATE INDEX "tournament_shell_grants_userId_idx"
    ON "tournament_shell_grants"("userId");

-- Cascade: a deleted tournament must not leave grants pointing at nothing.
ALTER TABLE "tournament_shell_grants"
    ADD CONSTRAINT "tournament_shell_grants_tournamentId_fkey"
    FOREIGN KEY ("tournamentId") REFERENCES "tournament_shells"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
