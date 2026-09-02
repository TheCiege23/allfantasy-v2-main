-- Player Finder — "Recently searched", per account.
--
-- One row per (user, sport, player); `searched_at` is bumped on every view, so
-- the rail reads the newest N by that column. Additive: a new table, no
-- changes to existing ones, no backfill, no long lock.
--
-- No foreign key on purpose. The session's user id and the LegacyUser/AppUser
-- ids are different id spaces in this schema, and a convenience list must never
-- fail a page render over a constraint.
--
-- Applied to production 2026-09-02 with `prisma db execute` and marked with
-- `prisma migrate resolve --applied`, NOT with `migrate deploy` — that command
-- reads the whole directory and would have carried another session's parked
-- migration along with it.

CREATE TABLE IF NOT EXISTS "recent_player_searches" (
  "id"          TEXT NOT NULL,
  "user_id"     TEXT NOT NULL,
  "sport"       VARCHAR(16) NOT NULL,
  "external_id" VARCHAR(128) NOT NULL,
  "sleeper_id"  VARCHAR(64),
  "name"        TEXT NOT NULL,
  "position"    VARCHAR(16),
  "team"        VARCHAR(16),
  "searched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "recent_player_searches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "recent_player_searches_user_id_sport_external_id_key"
  ON "recent_player_searches"("user_id", "sport", "external_id");

CREATE INDEX IF NOT EXISTS "recent_player_searches_user_id_searched_at_idx"
  ON "recent_player_searches"("user_id", "searched_at");
