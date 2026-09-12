-- Demote YahooConnection from a rival CREDENTIAL store to an identity record, so the two
-- Yahoo stores stop competing without either one having to hold a second copy of a token.
--
-- 🛑 PARKED, NOT APPLIED. Same rule as every file in this directory: `prisma migrate deploy`
-- reads the DIRECTORY, not git. This moves to prisma/migrations/ only when Guap explicitly
-- authorises applying it. Moving it is the deliberate act; writing it is not.
--
-- ── THE PROBLEM, MEASURED RATHER THAN ASSUMED ─────────────────────────────────────────────
-- There are two Yahoo credential stores and only ONE of them can ever be written in
-- production. Yahoo accepts exactly one registered redirect URI:
--
--     ACCEPTED  https://www.allfantasy.ai/api/league/yahoo/callback
--
-- Both entry points now resolve through `getYahooRedirectUri`, so `YAHOO_REDIRECT_URI` sends
-- EVERY flow to that one callback — and that callback writes `league_auths`. Therefore
-- `/api/auth/yahoo/callback` never executes. It is the only writer of `YahooConnection` and
-- the only place the `yahoo_user_id` / `yahoo_owner_user_id` cookies are set, both of which
-- `/api/yahoo/leagues` requires. So that route answers "Not connected to Yahoo" forever, and
-- `fetchYahooLeaguesForContext` never receives an id to look up.
--
-- The production counts recorded in `lib/league-import/provider-ui-config.ts` agree:
--     YahooLeague 0    YahooConnection 0    league_auths yahoo row 1
--
-- ── ⚠ WHY NOT THE OBVIOUS FIX (have the live callback write BOTH stores) ───────────────────
-- Because it puts two copies of a MUTABLE credential in play, each with its own refresh path:
--   lib/league-import/yahoo/YahooLeagueFetchService.refreshYahooAccessToken → league_auths
--   app/api/yahoo/leagues/route.refreshAccessToken                          → YahooConnection
-- Yahoo rotates the refresh token on use. Whichever path refreshed first would invalidate the
-- other copy; the loser would then get `invalid_grant`, and `clearDeadYahooCredentials` would
-- correctly wipe the credential and force a reconnect. That breaks the ONE Yahoo path that
-- works today in order to revive one that does not. Duplicating a rotating secret is not a
-- reconciliation, it is a second bug wearing the first one's clothes.
--
-- ── WHAT THIS MIGRATION DOES INSTEAD ──────────────────────────────────────────────────────
-- One credential store (`league_auths`), one identity store (`YahooConnection`). To let a
-- YahooConnection row exist WITHOUT credentials, its three token columns must become
-- nullable; to let it be found from a session instead of a cookie, it needs the link to our
-- own user that it has never had.
--
-- ⚠ THE COLUMNS ARE RELAXED, NOT DROPPED, AND THAT IS DELIBERATE. Production holds 0 rows,
-- but a developer database may hold real ones, and DROP COLUMN is irreversible. Relaxing is
-- enough to achieve the goal and costs nothing. It does leave the columns writable, which is
-- a code-discipline matter rather than a schema one — see the follow-up below.
--
-- ── ⚠ NO BACKFILL IS POSSIBLE, AND THAT IS WHY userId IS NULLABLE ──────────────────────────
-- There is no mapping anywhere from `YahooConnection.yahooUserId` to `app_users.id`. The only
-- link that ever existed was the `yahoo_owner_user_id` COOKIE, which lives in a browser and
-- not in this database. So existing rows cannot be given a userId by any query, and a NOT NULL
-- column would fail on them. Postgres permits many NULLs under a unique index, so the
-- constraint below still enforces one connection per user for every row that HAS one.
--
-- ── SAFETY ────────────────────────────────────────────────────────────────────────────────
-- Every statement is idempotent, so a re-run is a no-op that SUCCEEDS rather than a failure
-- that writes `finished_at IS NULL` into `_prisma_migrations` and blocks every later migration
-- with P3009 until someone resolves it by hand.
--   * `ALTER COLUMN ... DROP NOT NULL` is already a no-op when the column is nullable.
--   * `ADD COLUMN` / `CREATE UNIQUE INDEX` carry `IF NOT EXISTS`.
--   * `ADD CONSTRAINT` has NO `IF NOT EXISTS` in Postgres, so the foreign key is guarded on
--     `pg_constraint` — the same DO-block pattern this repo already uses in
--     `20260421140000_platform_notification_league_scope` and `20260627000000_add_league_championships`.
--
-- ⚠ NOTHING HERE REMOVES DATA. There is no DELETE and no DROP in this file.
--
-- ⚠ AND schema.prisma IS DELIBERATELY NOT UPDATED IN THIS CHANGE, for the reason already
-- recorded in this directory's README: adding `userId` there makes the generated client
-- include it in its DEFAULT SELECT for every read of the model, and against a database that
-- lacks the column that is P2022 on `findMany` — not confined to code that wants the new
-- field. The order is: apply this, THEN update schema.prisma, THEN ship the readers. Never
-- the reverse.
--
-- ── THE FOLLOW-UP THIS ENABLES (not in this file, and not pushable on its own) ─────────────
-- Once applied and once schema.prisma catches up:
--   1. `/api/league/yahoo/callback` — the one reachable callback — additionally upserts a
--      YahooConnection carrying `userId`, `yahooUserId` and `displayName` and NO tokens.
--   2. `/api/yahoo/leagues` finds that row by the SESSION user instead of the two cookies,
--      and takes its access token from `league_auths` like every other Yahoo caller. Its
--      local `refreshAccessToken` (which writes YahooConnection) goes away; the shared
--      reactive refresh already exists and already handles `invalid_grant`.
--   3. `fetchYahooLeaguesForContext` likewise keys on the app user.
-- That order matters: the callback must be able to WRITE the row before any reader depends on
-- it, or the surface reads a table nothing populates — the failure mode CLAUDE.md records for
-- `ingestCFBDStats`, where pointing a read at an unrefreshed table was worse than the live
-- call it replaced, because it fails silently and looks correct.

-- ── 1. The credential columns become optional ─────────────────────────────────────────────
-- A YahooConnection may now exist purely as identity. Tokens live in `league_auths`.

ALTER TABLE "YahooConnection" ALTER COLUMN "accessToken"    DROP NOT NULL;
ALTER TABLE "YahooConnection" ALTER COLUMN "refreshToken"   DROP NOT NULL;
ALTER TABLE "YahooConnection" ALTER COLUMN "tokenExpiresAt" DROP NOT NULL;

-- ── 2. The link the table has never had ───────────────────────────────────────────────────
-- TEXT to match `app_users."id"`, which is `String @id @default(uuid())` and therefore TEXT —
-- the same shape `league_auths."userId"` uses.

ALTER TABLE "YahooConnection" ADD COLUMN IF NOT EXISTS "userId" TEXT;

-- ── 3. One Yahoo connection per AllFantasy user ───────────────────────────────────────────
-- Consistent with `league_auths`, whose unique key is (userId, platform) and so already
-- permits exactly one yahoo row per user. Rows with a NULL userId do not collide.

CREATE UNIQUE INDEX IF NOT EXISTS "YahooConnection_userId_key"
  ON "YahooConnection"("userId");

-- ── 4. The foreign key, guarded ───────────────────────────────────────────────────────────
-- ON DELETE CASCADE matches `league_auths_userId_fkey`: deleting a user removes their Yahoo
-- connection, and `YahooLeague.connectionId` already cascades from there to leagues and teams.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'YahooConnection_userId_fkey'
  ) THEN
    ALTER TABLE "YahooConnection"
      ADD CONSTRAINT "YahooConnection_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "app_users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
