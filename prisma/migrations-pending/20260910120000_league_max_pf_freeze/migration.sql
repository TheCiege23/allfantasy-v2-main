-- Commissioner OS / EFL: durable regular-season Max PF freeze.
--
-- ADDITIVE ONLY. Two new tables. No column on any existing model is added, altered or dropped.
-- No backfill. Nothing destructive. Safe to apply while the app is running.
--
-- PARKED IN migrations-pending/ ON PURPOSE. `prisma migrate deploy` reads the DIRECTORY, so a
-- migration in prisma/migrations/ is live whether or not anybody meant to apply it. Moving this
-- file is the deliberate act; writing it is not. See prisma/migrations-pending/README.md.

CREATE TABLE "league_max_pf_freezes" (
    "id" TEXT NOT NULL,
    "leagueId" VARCHAR(64) NOT NULL,
    "season" INTEGER NOT NULL,
    "regularSeasonFinalWeek" INTEGER NOT NULL,
    "metric" VARCHAR(48) NOT NULL,
    "computationVersion" VARCHAR(96) NOT NULL,
    "values" JSONB NOT NULL,
    "fingerprint" VARCHAR(32) NOT NULL,
    "provenance" JSONB,
    "createdByUserId" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "league_max_pf_freezes_pkey" PRIMARY KEY ("id")
);

-- The freeze is unique per (league, season, metric, computationVersion). A metric or engine change
-- produces a NEW row rather than overwriting the old one, so two numbers that both call themselves
-- Max PF can never occupy the same slot and be silently compared.
CREATE UNIQUE INDEX "uniq_max_pf_freeze"
    ON "league_max_pf_freezes"("leagueId", "season", "metric", "computationVersion");

CREATE INDEX "league_max_pf_freezes_leagueId_season_idx"
    ON "league_max_pf_freezes"("leagueId", "season");

CREATE TABLE "league_max_pf_freeze_corrections" (
    "id" TEXT NOT NULL,
    "freezeId" VARCHAR(64) NOT NULL,
    "teamId" VARCHAR(64) NOT NULL,
    "previousValue" DOUBLE PRECISION NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "correctedByUserId" VARCHAR(64) NOT NULL,
    "correctedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "league_max_pf_freeze_corrections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "league_max_pf_freeze_corrections_freezeId_idx"
    ON "league_max_pf_freeze_corrections"("freezeId");

CREATE INDEX "league_max_pf_freeze_corrections_freezeId_teamId_idx"
    ON "league_max_pf_freeze_corrections"("freezeId", "teamId");

ALTER TABLE "league_max_pf_freeze_corrections"
    ADD CONSTRAINT "league_max_pf_freeze_corrections_freezeId_fkey"
    FOREIGN KEY ("freezeId") REFERENCES "league_max_pf_freezes"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
