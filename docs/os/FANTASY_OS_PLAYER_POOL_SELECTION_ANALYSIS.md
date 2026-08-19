# Player Pool Selection Analysis (Phase 27)

**Status: real measurements against `.env.test`, both pre- and post-fix.**

## Baseline scale (real, measured)

| Metric | Value |
|---|---|
| Total raw NFL `SportsPlayer` rows | 17,257 |
| Distinct NFL names | 12,004 |
| Distinct NFL players with any real AllFantasy ADP entry (all contexts) | **354** |
| Distinct playerKeys across ALL sports' ADP snapshots | 932 |
| Total `AllFantasyAdpSnapshot` rows | 1,431 |

## What this confirms

The real, fantasy-relevant universe (354 for NFL) is dramatically smaller than the full distinct-player universe (12,004) — a ~29x difference. This is the real, measured basis for treating "has any real ADP entry" as a strong, correct, provider-agnostic fantasy-relevance signal: it is AllFantasy's own aggregated data, not tied to any single external provider, and by construction only contains players someone has actually drafted in a real recorded draft.

## Coverage before this phase's fix (Phase 26 state)

| Metric | Value |
|---|---|
| Pool size at `limit: 800` | 831 (800 real + synthetic DEF entries) |
| Real distinct players in pool | 800 |
| Alphabetical span reached | "A'Shawn Robinson" → "Arjen Colquhoun" |
| ADP-candidate resolution rate (272 real candidates) | 20.6% (56/272) |
| Known real stars resolved (Saquon Barkley, Justin Jefferson, CeeDee Lamb, Bijan Robinson, Mike Evans, Jahmyr Gibbs, Ashton Jeanty) | **0 of 7** |

## Coverage after this phase's fix

| Metric | Value |
|---|---|
| Pool size at `limit: 800` | 832 |
| ADP-candidate resolution rate (same 272 real candidates) | **87.5% (238/272)** |
| Known real stars resolved | **7 of 7** |
| Remaining unresolved (34) | Dominated by suffix/punctuation variants (Jr., apostrophes) — the same minor secondary category Phase 26 already identified, not newly introduced |

## Starter/top-ranked coverage

At `limit: 800` (Draft's typical real call shape), all 354 ADP-relevant NFL players fit comfortably within the budget — meaning genuinely fantasy-relevant, ADP-tracked players (which includes essentially all real league starters and top-ranked players by construction) are now surfaced at effectively full coverage for calls with a limit at or above ~400.

**Real, disclosed residual limitation**: at smaller limits (Waiver's typical ~250, which is *less than* the 354-player ADP-relevant population), some ADP-relevant players can still be excluded — the fix's two-tier sort (ADP-relevant first, alphabetical tiebreak within each tier) means a late-alphabet ADP-relevant player can still fall outside a limit smaller than the ADP tier itself. Measured directly: at `limit: 250`, Saquon Barkley did not resolve while Justin Jefferson and CeeDee Lamb did. Full detail: `FANTASY_OS_DRAFT_WAIVER_IMPACT_REPORT.md`.
