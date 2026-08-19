# Keeper Intelligence Report (Phase 30)

## What changed

`assembleEngineInputFromPicks` now excludes players locked into a future (not-yet-materialized) keeper round from the `available` pool, in both the live decision path (`buildDraftDecisionContext`) and the backtest replay path (`buildHistoricalContext`).

## Real-data validation — honest disclosure

`.env.test` query results (2026-07-10):

| Metric | Real count |
|---|---|
| `DraftSession` rows total | 45 |
| `DraftSession.keeperSelections` non-null | **0** |
| `DraftSession.keeperConfig` non-null | **0** |
| `League.keeperCount > 0` | 65 |

**Zero real draft sessions in `.env.test` have ever materialized keeper data**, despite 65 leagues declaring keeper intent via the separate, unread `League.keeperCount` field. This is consistent with the architecture audit's finding that `League.keeperCount` is not wired to any live keeper mechanism — leagues can express keeper intent that never becomes an actual `DraftSession.keeperConfig`.

Real end-to-end validation against a live keeper draft is therefore **not possible in this environment**. Correctness was validated instead via 5 controlled-fixture unit tests (`__tests__/shared-services/draft/draft-context-assembler-keeper.test.ts`), covering: future-lock exclusion, backward compatibility when the field is omitted, `playerKey` normalization parity with the existing drafted-player exclusion path, no double-exclusion/throw when a player is both drafted and keeper-locked, and a `playerKey` regression check.

## Quality properties confirmed

- Deterministic (no randomness introduced)
- Backward compatible — omitting `keeperLockedPlayers` reproduces byte-identical pre-Phase-30 output
- Fails closed, not open — malformed keeper JSON degrades to zero exclusions rather than throwing
