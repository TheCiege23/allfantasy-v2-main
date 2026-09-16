-- Rollback for 20260914230000_chimmy_advice.
--
-- ⚠ DESTRUCTIVE: drops every piece of recorded Chimmy advice, and with it every Chimmy receipt
-- the home card could show. Nothing else references the table. Before running, record the row
-- count (select count(*) from "chimmy_advice") so the loss is a known number rather than a
-- surprise.

DROP INDEX IF EXISTS "chimmy_advice_user_id_given_at_idx";
DROP INDEX IF EXISTS "chimmy_advice_user_league_week_type_rec_alt_key";
DROP TABLE IF EXISTS "chimmy_advice";
