# Auction Architecture Audit (Phase 30)

## Real, live, transactional data

- `DraftSession.auctionBudgetPerTeam` (Int, default ~200)
- `DraftSession.auctionBudgets` (Json — per-roster remaining budget)
- `DraftSession.auctionState` (Json — nomination/bid state)
- `DraftPick.amount` (Int? — winning bid)

`AuctionEngine.ts`'s `resolveAuctionWin()` deducts budget inside a real `prisma.$transaction` — this is live, persisted state, not a theoretical schema.

## Existing reusable formulas (verified by direct read, `lib/mock-draft/draft-engine.ts` lines 94-110)

```ts
maxBid = Math.max(minimumBid, budget - (rosterSlotsRemaining - 1) * minimumBid)
```
via `getAuctionMaxBid({budget, rosterSlotsRemaining, minimumBid?})` and `canPlaceAuctionBid(...)`.

`getBudgetsFromSession(session: {auctionBudgetPerTeam, auctionBudgets, slotOrder})` — real, pure function in `lib/live-draft-engine/auction/AuctionEngine.ts` that resolves per-roster remaining budget from session state.

## The pre-Phase-30 gap

`RecommendationEngine.ts` had **zero awareness** of auction budget data (confirmed via grep: zero matches for "auction"/"budget" before this phase). A budget-constrained team and a flush team received identical recommendations for the same premium-ADP player, even though the constrained team could never actually afford them.

## UI exposure

`AuctionSpotlightPanel.tsx`'s live "Remaining budgets" list and `PostDraftView.tsx`'s budget summary already surface this data to real users today.

## Fix implemented

- `resolveAuctionContext(session, targetRosterId, rosterSlots, teamRosterCount)` — new, exported, pure function in `DraftContextAssembler.ts`. Returns `undefined` unless `session.draftType === 'auction'` (snake/linear drafts unaffected); reuses `getBudgetsFromSession` directly; never throws.
- `auctionAffordabilityAdjustment(adp, auctionContext)` — new function in `RecommendationEngine.ts`. Reuses `getAuctionMaxBid` directly (no new valuation system); applies a bounded penalty (`-10` for premium/ADP≤24 players the team can't realistically afford at `maxAffordable<20`, `-6` for mid-tier ADP≤60 at `maxAffordable<10`, `0` otherwise). Deterministic, no randomness.
- Wired into both the live path and the backtest path, identically to the Keeper fix.

No new valuation system was invented — ADP rank continues to be the engine's existing relative-value proxy; auction awareness only adjusts affordability, not the underlying ranking logic.
