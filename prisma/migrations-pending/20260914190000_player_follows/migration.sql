-- Follow a player across every league — retention item 3 (user decisions, 2026-09-14).
--
-- 🛑 PARKED. This lives in prisma/migrations-pending/ because applying it to production is the
-- user's call. Move it to prisma/migrations/ only as part of that authorised apply (see this
-- directory's README for why the directory, not git, is the deploy path).
--
-- One row per (user, sport, player). A follow belongs to no league on purpose: the existing
-- `waiver_watchlists` table keys on a NOT NULL league id, mixes Sleeper ids with
-- SportsPlayerRecord ids, and declares three columns production lacks, so it cannot carry a
-- cross-league follow.
--
-- `player_key` is the id the product joins on: the Sleeper id when the player has one (every
-- NFL surface in Core keys on it), otherwise his `SportsPlayer.externalId`. Both source ids are
-- kept beside it. The name, position and team are a snapshot for listing and are refreshed on
-- every follow.
--
-- Additive only: one new table, two indexes, no change to any existing table, no backfill, no
-- long lock. Nothing on main reads or writes it through a Prisma model — the code uses raw SQL
-- and treats a missing table (42P01) as "follows unavailable", so applying this ahead of or after
-- the code is safe in both orders. The model is added to schema.prisma only after this is
-- applied, so the schema-drift guard never sees a model without its table.
--
-- No foreign key, for the same reason as recent_player_searches: the session's user id and the
-- LegacyUser/AppUser ids are different id spaces, and a follow list must never fail a render over
-- a constraint.

CREATE TABLE IF NOT EXISTS "player_follows" (
  "id"          TEXT NOT NULL,
  "user_id"     TEXT NOT NULL,
  "sport"       VARCHAR(16) NOT NULL,
  "player_key"  VARCHAR(128) NOT NULL,
  "external_id" VARCHAR(128),
  "sleeper_id"  VARCHAR(64),
  "name"        TEXT NOT NULL,
  "position"    VARCHAR(16),
  "team"        VARCHAR(16),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "player_follows_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "player_follows_user_id_sport_player_key_key"
  ON "player_follows"("user_id", "sport", "player_key");

-- Senders fan out from a player to his followers (an injury on one player -> every follower).
CREATE INDEX IF NOT EXISTS "player_follows_sport_player_key_idx"
  ON "player_follows"("sport", "player_key");

-- The news sender knows only a player's NAME (player_news rows carry no id), so it finds
-- followers by (sport, lower(name)) — see listFollowerIdsForPlayer.
CREATE INDEX IF NOT EXISTS "player_follows_sport_lower_name_idx"
  ON "player_follows"("sport", lower("name"));
