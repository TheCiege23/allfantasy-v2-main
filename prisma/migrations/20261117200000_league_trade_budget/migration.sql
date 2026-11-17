-- Waiver budget money (FAAB) moved in a completed trade, from the row's own point of view.
-- Additive and nullable: NULL means "not read" (every row written before this), which is not the same as 0.
-- Fantrax's trade history export carries budget lines ("Budget Amount: $5000.00"); Sleeper carries waiver_budget.
ALTER TABLE "LeagueTrade"
  ADD COLUMN "budgetGiven" DOUBLE PRECISION,
  ADD COLUMN "budgetReceived" DOUBLE PRECISION;

ALTER TABLE "LeagueTrade" ADD CONSTRAINT "LeagueTrade_budget_nonnegative_check" CHECK (
  ("budgetGiven" IS NULL OR "budgetGiven" >= 0) AND ("budgetReceived" IS NULL OR "budgetReceived" >= 0)
);
