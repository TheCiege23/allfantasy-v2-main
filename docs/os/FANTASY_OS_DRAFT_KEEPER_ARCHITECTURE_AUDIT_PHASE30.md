# Keeper Architecture Audit (Phase 30)

## Config surfaces (three, not reconciled)

| Surface | Type | Read by live code? |
|---|---|---|
| `League.keeperCount` / related League fields | column | **No** — not read by any keeper runtime path found |
| `LeagueSettings.keeperCount` / `keeperSlots` | column | **No** — separate, unread surface |
| `DraftSession.keeperConfig` (Json?) / `DraftSession.keeperSelections` (Json?) | column | **Yes** — the only surface the live engine reads |

`KeeperAutomationService.runKeeperAutomationTick()` is the real, live mechanism: it reads `keeperConfig`/`keeperSelections`, and when the current on-the-clock slot matches a keeper's locked round, it materializes the kept player as a real `DraftPick` row (`source: 'keeper'`).

## The pre-Phase-30 gap

Once a keeper is materialized as a `DraftPick`, `DraftContextAssembler.ts`'s existing `draftedKeys` exclusion mechanism already removes them from `available` — this part of "avoid recommending kept players" was already correctly handled, contrary to the naive brief reading.

The real, previously undetected gap: a player locked into a **future** keeper round (present in `DraftSession.keeperSelections` but not yet materialized because the draft hasn't reached that round) was **not** excluded. They could be recommended to a different team, even though they are guaranteed to become the keeper-team's pick later.

## UI exposure

`KeeperPanel.tsx` and `DraftBoardCell.tsx`'s "K" badge already surface keeper state to real users today — the recommendation engine's blindness to future locks was a genuine, user-visible gap, not a theoretical one.

## Fix implemented

- `extractKeeperLockedPlayers(keeperSelectionsJson)` — new, exported, pure function in `DraftContextAssembler.ts`. Never throws; malformed/absent JSON degrades to `[]`.
- `AssembleEngineInputFromPicks` gained an optional `keeperLockedPlayers` param; each locked player's `playerKey(name, position)` is added to the existing `draftedKeys` set — reusing the exact same exclusion mechanism as real drafted picks, not a new one.
- Wired into both the live path (`buildDraftDecisionContext`) and the backtest path (`buildHistoricalContext` in `DraftBacktestRunner.ts`).

Scope explicitly excluded: `League.keeperCount` / `LeagueSettings.keeperCount` reconciliation — those surfaces remain unread by any live code, keeper or otherwise, and reconciling three competing config surfaces is out of this phase's narrow scope.
