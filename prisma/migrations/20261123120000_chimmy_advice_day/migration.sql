-- My Team's bench check in DAILY-lineup leagues (NBA / NHL / MLB leagues priced one day at a time):
-- the day a call was made for. Until now such calls were not recorded at all, because the unique key
-- (user, league, season, week, type, rec, alt) has no day, so filing a day's call under its week would
-- merge up to seven different calls into one row.
--
-- `advice_day` is '' for every weekly row (all existing rows, and every surface other than a daily
-- bench check) and 'YYYY-MM-DD' (the US Eastern day priced) for a daily call. '' and not NULL, for
-- the same reason as `alt_player_key`: NULLs are distinct in a Postgres unique index, so a NULL day
-- would stop the index deduping weekly rows.
--
-- CODE SHIPS FIRST AND IS SAFE EITHER SIDE OF THIS (lib/chimmy-advice/adviceStore.ts): it checks once
-- per process whether `advice_day` exists. Before, it writes exactly as it did and records no daily
-- call. After, every upsert targets the new key. A process that checked before the apply and then
-- meets the dropped index (42P10 on its ON CONFLICT) re-checks and retries on the new key.
--
-- SAFE ON A LIVE TABLE:
--   * ADD COLUMN with a constant DEFAULT is a metadata-only change (Postgres 11+): no rewrite.
--   * ORDER MATTERS: the new unique index is created BEFORE the old one is dropped. Its columns are a
--     superset of the old key's, so every existing row is already unique under it and the CREATE
--     cannot fail on data; and at no moment is the table without a unique key for ON CONFLICT.
--     The build takes a SHARE lock (writes wait, reads do not) for the length of one index build on a
--     small table.
--
-- Reversible, but ONLY while no daily rows exist (two days of one week would collide on the old key):
--   DELETE FROM "chimmy_advice" WHERE "advice_day" <> '';
--   CREATE UNIQUE INDEX "chimmy_advice_user_league_week_type_rec_alt_key" ON "chimmy_advice"("user_id", "league_id", "season", "week", "advice_type", "rec_player_key", "alt_player_key");
--   DROP INDEX "chimmy_advice_user_league_week_day_type_rec_alt_key";
--   ALTER TABLE "chimmy_advice" DROP COLUMN "advice_day";

-- AlterTable
ALTER TABLE "chimmy_advice" ADD COLUMN "advice_day" VARCHAR(10) NOT NULL DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "chimmy_advice_user_league_week_day_type_rec_alt_key" ON "chimmy_advice"("user_id", "league_id", "season", "week", "advice_day", "advice_type", "rec_player_key", "alt_player_key");

-- DropIndex
DROP INDEX "chimmy_advice_user_league_week_type_rec_alt_key";
