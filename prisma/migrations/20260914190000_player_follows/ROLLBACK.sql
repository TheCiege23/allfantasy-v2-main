-- Rollback for 20260914190000_player_follows.
--
-- ⚠ DESTRUCTIVE: drops every follow users have made. Nothing else references the table.
-- Before running, record the row count (select count(*) from "player_follows") so the loss is
-- a known number rather than a surprise.

DROP INDEX IF EXISTS "player_follows_sport_lower_name_idx";
DROP INDEX IF EXISTS "player_follows_sport_player_key_idx";
DROP INDEX IF EXISTS "player_follows_user_id_sport_player_key_key";
DROP TABLE IF EXISTS "player_follows";
