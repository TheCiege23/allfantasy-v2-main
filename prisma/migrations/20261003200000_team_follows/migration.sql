-- Team follows (owner's call, 2026-10-03): one row per (user, sport, team), keyed on the canonical
-- abbreviation from sports_core_teams. Additive: one new empty table and its indexes, no change to
-- any existing table and no foreign key (as player_follows). The application treats a missing table
-- as "follows unavailable" (42P01), so code may land before this is applied.

-- CreateTable
CREATE TABLE "team_follows" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sport" VARCHAR(16) NOT NULL,
    "team_abbr" VARCHAR(16) NOT NULL,
    "team_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_follows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "team_follows_sport_team_abbr_idx" ON "team_follows"("sport", "team_abbr");

-- CreateIndex
CREATE UNIQUE INDEX "team_follows_user_id_sport_team_abbr_key" ON "team_follows"("user_id", "sport", "team_abbr");
