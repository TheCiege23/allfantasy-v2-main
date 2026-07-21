-- player_game_stats: add the 7 provider/telemetry columns schema.prisma declares but prod
-- never received (schema drifted ahead; the table has 0 rows so nothing ever hit it).
-- Purely additive, all nullable, safe on an empty or populated table.
ALTER TABLE "player_game_stats" ADD COLUMN IF NOT EXISTS "provider_player_id" VARCHAR(128);
ALTER TABLE "player_game_stats" ADD COLUMN IF NOT EXISTS "provider_game_id" VARCHAR(128);
ALTER TABLE "player_game_stats" ADD COLUMN IF NOT EXISTS "source" VARCHAR(64);
ALTER TABLE "player_game_stats" ADD COLUMN IF NOT EXISTS "confidence" DOUBLE PRECISION;
ALTER TABLE "player_game_stats" ADD COLUMN IF NOT EXISTS "source_updated_at" TIMESTAMP(3);
ALTER TABLE "player_game_stats" ADD COLUMN IF NOT EXISTS "fetched_at" TIMESTAMP(3);
ALTER TABLE "player_game_stats" ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMP(3);
