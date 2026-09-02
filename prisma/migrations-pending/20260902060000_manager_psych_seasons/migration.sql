-- Manager psychology: per-season snapshots (P1) and a queryable league format (P3).
--
-- ✅ ALREADY APPLIED TO PRODUCTION 2026-09-02, BY THE OWNER, AS RAW SQL.
-- Verified by effect via `information_schema`: 15 columns on the new table, all four indexes
-- present including the unique one, and the `format` column on `manager_psych_profiles`.
--
-- 🛑 SO THIS IS A BACKFILL OF THE MIGRATION HISTORY, NOT A PENDING CHANGE — the same third case
-- as `20260901220000_domain_os_facts`, and it behaves identically: created by hand, so there is
-- **no `_prisma_migrations` row**, so a future `migrate deploy` will RUN it rather than skip it.
-- Every statement is `IF NOT EXISTS`, making that run a no-op that succeeds and finally records
-- the row. Self-healing by construction — the guards, not luck.
--
-- ── 🛑 WHY (B) EXISTS: THE PROFILE IS ONE ROW, OVERWRITTEN ──────────────────────────────────
--
-- `manager_psych_profiles` is `@@unique([leagueId, managerId])` and every refresh upserts it. So
-- "he was a patient rebuilder in 2023 and has been win-now since 2024" was not an unimplemented
-- feature — it was UNANSWERABLE from the data as stored, and each refresh destroyed the prior
-- reading. `BehaviorSignalAggregator.seasonThrough()` uses `season <= n` deliberately (a dynasty
-- league carries picks under 2021-2025, so exact equality returns nothing), which is right for a
-- cumulative headline and useless for direction.
--
-- ⚠ THE CLOCK STARTED WHEN THIS WAS APPLIED. Snapshots accumulate from the first refresh after
-- the table existed; seasons before that are simply not recorded. A backfill from
-- `dw_transaction_facts` and `profile_evidence_records` is possible — both carry timestamps — and
-- is deliberately NOT attempted here. Reconstructing history is a separate, explicitly-scoped job,
-- not something to slip into a schema change.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- (A) A queryable league format on the existing profile.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- 🛑 NULLABLE, AND THE UNIQUE KEY IS DELIBERATELY NOT WIDENED. A league has exactly one format, so
-- `(leagueId, managerId)` already yields one profile per format — this column makes the format
-- QUERYABLE so a cross-league read can group by it. Widening the key would let one league hold two
-- profiles for one manager, which is simply wrong.
--
-- NULL means "not yet resolved", which is honest and distinguishable from a league that genuinely
-- has no format. The backfill is R4b.1 and has not run.
--
-- Expected values: dynasty · redraft · keeper · bestball · guillotine · devy. Deliberately NOT an
-- enum — `LeagueSport` is one, and adding a format then needs a migration just to be nameable.

ALTER TABLE "manager_psych_profiles"
  ADD COLUMN IF NOT EXISTS "format" VARCHAR(24);

CREATE INDEX IF NOT EXISTS "manager_psych_profiles_managerId_sport_format_idx"
  ON "manager_psych_profiles" ("managerId", "sport", "format");

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- (B) Per-season snapshots — the history the live profile cannot hold.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- 🛑 A SEPARATE TABLE, NOT A `season` COLUMN ON THE EXISTING ONE. Adding `season` there would
-- change its unique key and break `findUnique({ where: { leagueId_managerId } })`, which the
-- engine and several routes call. The live profile stays exactly as it is and every current
-- reader is untouched; this is written alongside it.

CREATE TABLE IF NOT EXISTS "manager_psych_profile_seasons" (
  "id"                  TEXT NOT NULL,
  "leagueId"            VARCHAR(64)  NOT NULL,
  "managerId"           VARCHAR(128) NOT NULL,
  "sport"               VARCHAR(16)  NOT NULL,
  "format"              VARCHAR(24),
  "season"              INTEGER      NOT NULL,
  "profileLabels"       JSONB        NOT NULL DEFAULT '[]',
  "aggressionScore"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "activityScore"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "tradeFrequencyScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "waiverFocusScore"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  "riskToleranceScore"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  -- Observations behind the snapshot. Zero is a real answer, so NOT NULL is correct here.
  "sampleSize"          INTEGER      NOT NULL DEFAULT 0,
  -- ⚠ NULLABLE, AND THE ASYMMETRY WITH sampleSize IS THE POINT. Null means that season never
  -- cleared its evidence floor: recorded as HAVING HAPPENED, but not as having been MEASURED.
  -- `summariseTrajectory` refuses to rest a "he changed" claim on such a season, so P6 is enforced
  -- by the schema rather than by discipline. A zero here would read as measured indifference.
  "confidence"          DOUBLE PRECISION,
  "computedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "manager_psych_profile_seasons_pkey" PRIMARY KEY ("id")
);

-- 🛑 LOAD-BEARING: the writer upserts `ON CONFLICT ("leagueId","managerId","season")`. Without
-- this index the upsert throws at runtime, and the profile refresh — which fires every 30 minutes
-- — would instead grow a row per fire, turning a two-season trajectory into hundreds of identical
-- "seasons" that look like data.
CREATE UNIQUE INDEX IF NOT EXISTS "manager_psych_profile_seasons_league_manager_season_key"
  ON "manager_psych_profile_seasons" ("leagueId", "managerId", "season");

-- One manager across seasons — the trajectory read.
CREATE INDEX IF NOT EXISTS "manager_psych_profile_seasons_manager_sport_season_idx"
  ON "manager_psych_profile_seasons" ("managerId", "sport", "season");

-- One league in one season — the "how did this league behave" read.
CREATE INDEX IF NOT EXISTS "manager_psych_profile_seasons_league_season_idx"
  ON "manager_psych_profile_seasons" ("leagueId", "season");

-- ⚠ NO FOREIGN KEY TO `manager_psych_profiles`, DELIBERATELY. A season snapshot must OUTLIVE the
-- cumulative row: profiles are upserted and could be pruned, and history must not cascade away
-- with them. That is the whole reason this table exists.
