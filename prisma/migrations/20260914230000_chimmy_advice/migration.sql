-- Chimmy advice receipts — retention item 6 (user decisions, 2026-09-14).
--
-- 🛑 PARKED. This lives in prisma/migrations-pending/ because applying it to production is the
-- user's call. Move it to prisma/migrations/ only as part of that authorised apply (see this
-- directory's README for why the directory, not git, is the deploy path).
--
-- One row per piece of advice Chimmy GAVE a user: "start X over Y" from the start/sit
-- comparison, and (next) the lineup and waiver suggestions the Chimmy chat grounds on. The home
-- Receipts card later says how that advice turned out.
--
-- ⚠ ONLY WHAT WAS SAID IS STORED — NEVER THE OUTCOME. Whether the advice was right, and whether
-- the user followed it, are computed at read time from `league_player_weekly_scores` (the
-- platform's own points and starters), exactly like the trade, waiver and lineup receipts. So
-- nothing needs a resolver cron, and a late score correction can never leave a stale verdict.
--
-- `rec_player_key` / `alt_player_key` are the ids the product joins on: the Sleeper id for a
-- Sleeper league (the writer resolves names against the user's own roster and records nothing
-- when a name is ambiguous). `alt_*` is NULL for an add, which has no alternative.
--
-- `league_id` is the AllFantasy League.id. `season` / `week` are the NFL week the advice was for.
--
-- Additive only: one new table, one unique index, one lookup index. No change to any existing
-- table, no backfill, no long lock. The code uses raw SQL and treats a missing table (42P01) as
-- "advice unavailable", so applying this ahead of or after the code is safe in both orders. The
-- model is added to schema.prisma only after this is applied, so the schema-drift guard never
-- sees a model without its table.
--
-- No foreign key, for the same reason as player_follows: the session's user id and the
-- LegacyUser/AppUser ids are different id spaces, and a render must never fail over a constraint.

CREATE TABLE IF NOT EXISTS "chimmy_advice" (
  "id"             TEXT NOT NULL,
  "user_id"        TEXT NOT NULL,
  "league_id"      TEXT NOT NULL,
  "sport"          VARCHAR(16) NOT NULL,
  "season"         INTEGER NOT NULL,
  "week"           INTEGER NOT NULL,
  "advice_type"    VARCHAR(24) NOT NULL,
  "surface"        VARCHAR(40) NOT NULL,
  "rec_player_key" VARCHAR(128) NOT NULL,
  "rec_name"       TEXT NOT NULL,
  "alt_player_key" VARCHAR(128) NOT NULL DEFAULT '',
  "alt_name"       TEXT,
  "slot"           VARCHAR(16),
  "confidence_pct" INTEGER,
  "given_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "chimmy_advice_pkey" PRIMARY KEY ("id")
);

-- Asking the same question twice records the advice once. `alt_player_key` is '' (not NULL) for
-- an add so the unique index still dedupes it — NULLs are distinct in a Postgres unique index.
CREATE UNIQUE INDEX IF NOT EXISTS "chimmy_advice_user_league_week_type_rec_alt_key"
  ON "chimmy_advice"("user_id", "league_id", "season", "week", "advice_type", "rec_player_key", "alt_player_key");

-- The Receipts card reads a user's recent advice, newest first.
CREATE INDEX IF NOT EXISTS "chimmy_advice_user_id_given_at_idx"
  ON "chimmy_advice"("user_id", "given_at" DESC);
