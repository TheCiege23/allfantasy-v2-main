# Draft OS & Waiver OS Impact Report (Phase 27)

**Status: real measurements against `.env.test` for both domains. Both improved; one real, disclosed residual limitation found for Waiver's smaller typical limit.**

## Draft OS impact (real, measured)

Using the real backtest/context-assembly path (`limit: 800`, Draft's typical real call shape):

| Metric | Phase 26 (before) | Phase 27 (after) |
|---|---|---|
| ADP-candidate resolution rate | 20.6% (56/272) | **87.5% (238/272)** |
| Known real stars resolved | 0/7 | **7/7** |
| Pool size | 831 | 832 |

**No regression**: existing Draft OS test suite (`__tests__/shared-services/draft/`, `__tests__/live-draft-engine/`, `__tests__/draft/sport-player-pool.test.ts`) — 100% passing (see Required Verification section of the final report for exact counts).

## Waiver OS impact (real, measured)

`WaiverContextAssembler.ts` calls the same resolver with a `maxFreeAgents`-driven limit — measured at a representative real value (`limit: 250`, smaller than Draft's typical 800):

| Metric | Result |
|---|---|
| Pool size at `limit: 250` | 282 (250 real + synthetic DEF) |
| Justin Jefferson resolves | Yes |
| CeeDee Lamb resolves | Yes |
| **Saquon Barkley resolves** | **No** |

**Real, honest, disclosed finding — not overstated as a full fix for Waiver**: at a limit smaller than the 354-player NFL ADP-relevant population, the fix's two-tier sort (ADP-relevant first, alphabetical tiebreak within tier) can still exclude a late-alphabet ADP-relevant player. This is a genuine, measured improvement over the pre-fix state (which excluded virtually all late-alphabet players regardless of relevance) but not a complete fix at Waiver's smaller typical limit. Full technical reasoning in `FANTASY_OS_PLAYER_POOL_STRATEGY_COMPARISON.md`'s "Residual gap" section.

**No regression**: full Waiver OS test suite (`__tests__/shared-services/waiver/`, `__tests__/waiver-wire-player-route-pool-resolver.test.ts`, `__tests__/waiver-ai-engine-route-contract.test.ts`) — 9 files/64 tests, 100% passing.

## Net assessment

Both domains improved. Draft OS's typical real call shape (`limit: 800`) sees the fix's full benefit (87.5% resolution, all real stars resolved). Waiver OS sees a real, partial improvement, with an honestly disclosed residual gap at its smaller typical limit — recommended as the natural next increment (sort within the ADP tier by real ADP rank rather than alphabetically) rather than claimed as fully solved.
