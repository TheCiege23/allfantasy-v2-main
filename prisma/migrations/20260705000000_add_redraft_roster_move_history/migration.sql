-- Phase 2H: redraft lineup-save history, so Decision OS Phase 6 DNA can read a
-- real `week` value for redraft lineup_saved events (previously only possible
-- via free-agent roster additions, which honestly carry week=null and are
-- therefore invisible to every lineup-based pattern detector — see
-- docs/DECISION_OS_MANAGER_DNA_PHASE2G_VOLUME_AND_LINEUP_HISTORY_SCOPE.md).
--
-- SAFETY:
--  * Purely ADDITIVE — one new table + two indexes + two FK constraints to
--    existing tables (leagues, redraft_rosters). No existing table/column
--    changed.
--  * Mirrors the existing af_roster_move_history table's shape and
--    conventions exactly (see 20260421120000_roster_lineup_engine).
--  * Business behavior does not depend on this table — it is written
--    best-effort by the redraft lineup-save route and read best-effort by
--    the Decision OS behavioral event port; both paths degrade safely if
--    this table is empty or the write fails (see the application code for
--    the try/catch around the write call).

CREATE TABLE "redraft_roster_move_history" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "rosterId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "actorUserId" VARCHAR(128),
    "source" VARCHAR(32) NOT NULL,
    "moveSummary" VARCHAR(512),
    "beforeHash" VARCHAR(64),
    "afterHash" VARCHAR(64),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "redraft_roster_move_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "redraft_roster_move_history_leagueId_rosterId_createdAt_idx" ON "redraft_roster_move_history"("leagueId", "rosterId", "createdAt");

CREATE INDEX "redraft_roster_move_history_leagueId_seasonId_week_idx" ON "redraft_roster_move_history"("leagueId", "seasonId", "week");

ALTER TABLE "redraft_roster_move_history" ADD CONSTRAINT "redraft_roster_move_history_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "redraft_roster_move_history" ADD CONSTRAINT "redraft_roster_move_history_rosterId_fkey" FOREIGN KEY ("rosterId") REFERENCES "redraft_rosters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
