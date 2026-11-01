-- af_trade_deadline_default_20261027 — UNDO
--
-- REVIEW FIRST. Restores leagues."tradeDeadlineWeek" from the pre-image table the backfill created
-- (scripts/sql/af_trade_deadline_default_20261027.sql). A league is restored only while its deadline is
-- still exactly what the backfill wrote; a league whose commissioner has since changed or cleared it is
-- left alone and reported. One transaction.

-- Preview (read-only): what would be restored, and what has moved since the backfill.
SELECT
  p.league_id,
  l.name,
  p.sport,
  l."tradeDeadlineWeek"       AS current_value,
  p.new_trade_deadline_week   AS backfill_wrote,
  p.old_trade_deadline_week   AS restore_to,
  (l."tradeDeadlineWeek" IS NOT DISTINCT FROM p.new_trade_deadline_week) AS will_restore
FROM af_trade_deadline_default_20261027 p
LEFT JOIN leagues l ON l.id = p.league_id
ORDER BY p.sport, l.name, p.league_id;

BEGIN;

DO $$
DECLARE captured integer; restorable integer; restored integer;
BEGIN
  SELECT count(*) INTO captured FROM af_trade_deadline_default_20261027;
  SELECT count(*) INTO restorable
  FROM af_trade_deadline_default_20261027 p
  JOIN leagues l ON l.id = p.league_id
  WHERE l."tradeDeadlineWeek" IS NOT DISTINCT FROM p.new_trade_deadline_week;

  UPDATE leagues l
  SET "tradeDeadlineWeek" = p.old_trade_deadline_week
  FROM af_trade_deadline_default_20261027 p
  WHERE l.id = p.league_id
    AND l."tradeDeadlineWeek" IS NOT DISTINCT FROM p.new_trade_deadline_week;
  GET DIAGNOSTICS restored = ROW_COUNT;

  IF restored <> restorable THEN
    RAISE EXCEPTION 'af_trade_deadline_default_20261027 undo: restored % but % were restorable — nothing applied', restored, restorable;
  END IF;
  RAISE NOTICE 'af_trade_deadline_default_20261027 undo: restored % of % captured rows (% changed since, left alone)',
    restored, captured, captured - restored;
END $$;

COMMIT;

-- After confirming the restore, the pre-image can be dropped by hand:
--   DROP TABLE af_trade_deadline_default_20261027;
