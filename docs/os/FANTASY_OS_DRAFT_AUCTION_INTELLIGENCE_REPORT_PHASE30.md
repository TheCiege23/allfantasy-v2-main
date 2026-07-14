# Auction Intelligence Report (Phase 30)

## What changed

`computeDraftPlayerRankings` now applies a bounded affordability adjustment for auction drafts, reusing the existing `getAuctionMaxBid` formula rather than inventing a new valuation system. Wired into both the live and backtest paths.

## Real-data validation — honest disclosure

`.env.test` query results (2026-07-10):

| Metric | Real count |
|---|---|
| `DraftSession.draftType` distribution | `snake: 41`, `linear: 4` |
| `DraftSession.draftType === 'auction'` | **0** |

**Zero real auction draft sessions exist in `.env.test`.** Every real session in this environment is snake or linear. Real end-to-end validation against a live auction draft is therefore **not possible in this environment**.

Correctness was validated instead via 5 controlled-fixture unit tests (`__tests__/draft-helper/recommendation-engine-auction.test.ts`), covering: a premium-ADP player scoring lower for a budget-constrained team than a flush team, a late-ADP/cheap player being unaffected by budget constraints, backward compatibility when `auctionContext` is omitted or explicitly `undefined`, zero-roster-slots-remaining not throwing, and determinism (identical input always produces identical output).

## Quality properties confirmed

- Deterministic
- Backward compatible — omitting `auctionContext` (or snake/linear drafts, where `resolveAuctionContext` returns `undefined`) reproduces byte-identical pre-Phase-30 output
- Bounded — the adjustment is a fixed penalty from a small discrete set (`0`, `-6`, `-10`), not an unbounded or compounding multiplier
