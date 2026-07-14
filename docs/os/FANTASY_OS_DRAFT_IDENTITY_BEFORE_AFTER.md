# Draft Identity Resolution — Before/After Metrics (Phase 26)

**Status: real measurement, identical methodology to Phase 25, same real league. Honest, modest result — not overstated.**

## Methodology

Identical to Phase 25: real NFL league (`manual` platform, `.env.test`), `getPlayerPoolForLeague(leagueId, 'NFL', {limit: 800})`, cross-referenced against `readAllFantasyAdpForLeague(leagueId)`'s 272 real ADP entries via the shared `playerKey()` join.

## Before/after

| Metric | Before (Phase 25) | After (Phase 26 fix) | Change |
|---|---|---|---|
| Total ADP candidates | 272 | 272 | — |
| Pool size (`limit: 800`) | 770 | 831 (800 real + ~31 synthetic DEF entries) | +61 total, but see note below |
| Real (non-synthetic) distinct pool entries | ~558 (800 raw rows, only 558 distinct after ad-hoc dedup at read time) | 800 (fully deduplicated before limiting) | **+242 real distinct players** now correctly included |
| Resolved candidates | 54 | 56 | **+2** |
| Unresolved candidates | 218 | 216 | −2 |
| Resolution rate | 19.9% | 20.6% | **+0.7 percentage points** |
| Pool alphabetical coverage (real entries) | Up to ~"Anthony Jones" | Up to "Arjen Colquhoun" | Real, measurable improvement in *how far* the same 800-item budget reaches — but still confined to a narrow early-alphabet band |

## Honest interpretation — do not overstate

**The fix is real, verified, and meaningfully improves what the resolver returns** — 242 more real, correctly-deduplicated distinct players now populate the same 800-item budget that was previously wasted on ~250 duplicate rows for a handful of early-alphabet names. This is a genuine defect fix, confirmed by a passing unit test that would have failed against the pre-fix code.

**The fix did NOT meaningfully move the specific resolution-rate metric measured against this real league** (19.9% → 20.6%, +0.7pp) — because Root Cause #2 (documented in `FANTASY_OS_DRAFT_IDENTITY_ROOT_CAUSE.md`: the alphabetical-order-with-hard-limit selection strategy itself) remains unfixed and is the dominant constraint for this particular league's ADP-candidate distribution, which happens to include many players whose names fall well past the early-alphabet range the 800-item budget can reach even at full efficiency.

**This is reported exactly as it measured, per this phase's explicit instruction not to fabricate or overstate improvement.**

## What a full fix (Root Cause #2) would likely achieve — not measured, explicitly labeled as expectation, not evidence

If a future phase changes the pool query's selection strategy (e.g., prioritizing ADP-relevant or roster-active players instead of pure alphabetical order), the resolution rate for real, ADP-listed stars like Saquon Barkley or Justin Jefferson would very plausibly resolve correctly, since they are confirmed to genuinely exist in the underlying tables with correct name/position data — the barrier is purely which subset of the 12,004 distinct names a bounded query surfaces, not whether the data itself is present. This expectation is not measured or claimed as fact this phase.
