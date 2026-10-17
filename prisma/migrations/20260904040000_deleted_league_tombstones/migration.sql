-- DeletedLeagueTombstone: remember that a user removed a league, so it does not come back.
--
-- 🛑 PARKED. NOT APPLIED ANYWHERE. See prisma/migrations-pending/README.md.
--
-- Purely ADDITIVE: one new table, no change to any existing table, no data
-- migration. Nothing reads or writes it until the accompanying code ships, so
-- applying this ahead of the code is a no-op rather than a breaking change --
-- the opposite of a column type change, where the client and the column must
-- agree. It is parked because this directory's rule is that migrations are
-- applied on explicit instruction, not because the ordering is delicate.
--
-- ⚠ WHY A TABLE AND NOT A `deletedAt` COLUMN ON `leagues`. Two reasons, both
-- load-bearing:
--   1. Other users attach to the same League row (RedraftLeagueMember.userId,
--      LeagueTeam.claimedByUserId, and get-dashboard-league-list.ts unions all
--      three). A column on `leagues` would hide the league from co-members who
--      never asked for that.
--   2. `DELETE /api/league/[leagueId]` is a HARD delete. The tombstone has to
--      OUTLIVE the row it refers to, which a column on that row cannot do.
--
-- Keyed on the external identity (platform + platformLeagueId), never on
-- leagues.id, because a re-import mints a new id.
--
-- No FK to `leagues` for the same reason: the row it describes is gone by the
-- time this is written. The only FK is to app_users, which cascades so a
-- deleted account does not leave tombstones behind.

CREATE TABLE "deleted_league_tombstones" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "platformLeagueId" TEXT NOT NULL,
    "leagueName" TEXT,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deleted_league_tombstones_pkey" PRIMARY KEY ("id")
);

-- The upsert in recordLeagueTombstone targets this constraint by name
-- (userId_platform_platformLeagueId). Deleting, re-importing and deleting again
-- must refresh the row rather than raise a unique violation.
CREATE UNIQUE INDEX "deleted_league_tombstones_userId_platform_platformLeagueId_key"
    ON "deleted_league_tombstones"("userId", "platform", "platformLeagueId");

-- listLeagueTombstones() reads every tombstone for one user.
CREATE INDEX "deleted_league_tombstones_userId_idx"
    ON "deleted_league_tombstones"("userId");

ALTER TABLE "deleted_league_tombstones"
    ADD CONSTRAINT "deleted_league_tombstones_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "app_users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
