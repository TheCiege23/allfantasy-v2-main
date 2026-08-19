-- Opponent context for player game stats.
--
-- Sleeper's api.sleeper.com weekly stats response ALREADY carries `opponent`, `team`
-- and `date` per row — the parser was discarding all three. Without them a player's
-- history cannot answer "how did he do against this defense", which is the whole
-- basis of the opponent adjustment.
--
-- `team` is the team AT THE TIME OF THE GAME, which is deliberately not the same as
-- the player's current team: a 2024 row for Tank Bigsby carries team = JAX while his
-- current team is PHI. Storing the game-time team is what keeps historical splits
-- attributed to the right franchise.
--
-- All three are nullable: 40,473 pre-existing 2025 rows were written before these
-- columns existed and must not be back-filled with guesses.

ALTER TABLE "player_game_stats" ADD COLUMN IF NOT EXISTS "opponent" VARCHAR(8);
ALTER TABLE "player_game_stats" ADD COLUMN IF NOT EXISTS "team" VARCHAR(8);
ALTER TABLE "player_game_stats" ADD COLUMN IF NOT EXISTS "game_date" DATE;

-- Supports "this player vs this defense, across seasons", the query the opponent
-- adjustment actually runs.
CREATE INDEX IF NOT EXISTS "player_game_stats_player_opponent_idx"
  ON "player_game_stats" ("playerId", "sportType", "opponent");

-- Supports "what this defense allowed to this position", the larger-sample signal.
CREATE INDEX IF NOT EXISTS "player_game_stats_opponent_season_idx"
  ON "player_game_stats" ("sportType", "opponent", "season");
