-- Multi-team (3- and 4-team) native redraft trades. Additive only: every existing row reads as a
-- two-team trade (no additional teams, no per-team acceptances), which is exactly what it is.
ALTER TABLE "redraft_trade_proposals" ADD COLUMN "additionalRosterIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "redraft_trade_proposals" ADD COLUMN "acceptedRosterIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
