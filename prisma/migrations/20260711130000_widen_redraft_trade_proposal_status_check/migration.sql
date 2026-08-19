-- Widen redraft_trade_proposals_status_check to allow 'reversed'.
--
-- Found via physical validation against a disposable Neon branch forked from
-- production: lib/league-trade-engine/tradeReversalService.ts writes
-- status='reversed' on a completed reversal, but the check constraint added
-- in 20260408195500_redraft_trade_playoff_core only allowed
-- ('pending','accepted','rejected','vetoed','cancelled','expired','processed'),
-- so every real reversal of a native redraft trade failed at the database
-- layer with a 23514 check-violation, even though the readiness check and
-- the rest of the transaction were correct. Additive only: no existing value
-- is removed, no table/column/type is dropped.
ALTER TABLE "redraft_trade_proposals" DROP CONSTRAINT "redraft_trade_proposals_status_check";
ALTER TABLE "redraft_trade_proposals" ADD CONSTRAINT "redraft_trade_proposals_status_check"
  CHECK ("status" IN ('pending', 'accepted', 'rejected', 'vetoed', 'cancelled', 'expired', 'processed', 'reversed'));
