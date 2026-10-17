-- Owner-scoped strategy state and its atomic event ledger. Access is through authenticated server APIs.
CREATE TABLE IF NOT EXISTS "decision_strategy_states" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "leagueId" TEXT NOT NULL,
  "season" INTEGER NOT NULL,
  "active" VARCHAR(16) NOT NULL DEFAULT 'balanced' CHECK ("active" IN ('balanced', 'win-now', 'rebuild')),
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  "pending" JSONB,
  "lastObservedWeek" INTEGER CHECK ("lastObservedWeek" >= 1),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "decision_strategy_states_userId_leagueId_season_key"
  ON "decision_strategy_states" ("userId", "leagueId", "season");
CREATE TABLE IF NOT EXISTS "decision_strategy_events" (
  "id" TEXT PRIMARY KEY,
  "stateId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "leagueId" TEXT NOT NULL,
  "season" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL,
  "action" VARCHAR(16) NOT NULL CHECK ("action" IN ('observe', 'confirm')),
  "evidenceId" TEXT,
  "before" JSONB NOT NULL,
  "after" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "decision_strategy_events_stateId_revision_key"
  ON "decision_strategy_events" ("stateId", "revision");
CREATE INDEX IF NOT EXISTS "decision_strategy_events_userId_leagueId_season_createdAt_idx"
  ON "decision_strategy_events" ("userId", "leagueId", "season", "createdAt");
ALTER TABLE "decision_strategy_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_strategy_events" ENABLE ROW LEVEL SECURITY;
-- No public policies: browser/database roles cannot inspect another manager's strategy.
-- Rollback: previous application ignores these additive tables; retain state and audit history.
