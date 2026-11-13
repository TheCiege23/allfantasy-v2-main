-- A player's position for one scoring week (lib/bestball/weekPositions.ts). Recorded when the week's
-- weekly score is written, frozen when the week finalizes. Additive: nothing reads it as required, and
-- every reader falls back to the current position while this table is absent or empty.
CREATE TABLE IF NOT EXISTS "player_week_positions" (
  "playerId"   TEXT NOT NULL,
  "sport"      TEXT NOT NULL,
  "season"     INTEGER NOT NULL,
  "week"       INTEGER NOT NULL,
  "position"   TEXT,
  "source"     TEXT NOT NULL,
  "frozen"     BOOLEAN NOT NULL DEFAULT false,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "player_week_positions_pkey" PRIMARY KEY ("playerId", "sport", "season", "week")
);
CREATE INDEX IF NOT EXISTS "player_week_positions_sport_season_week_idx" ON "player_week_positions" ("sport", "season", "week");
ALTER TABLE "player_week_positions" ENABLE ROW LEVEL SECURITY;
