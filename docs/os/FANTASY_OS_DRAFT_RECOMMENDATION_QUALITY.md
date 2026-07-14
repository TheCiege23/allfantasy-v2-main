# Draft OS — Recommendation Quality Assessment (Phase 25)

**Status: measured where real data allowed; several dimensions verified by direct code reading given the historical-replay data gap.**

## Deterministic behavior — verified, real

`lib/draft-helper/RecommendationEngine.ts` contains **zero** `Math.random()`/`Date.now()`-influenced branching (confirmed by grep across the whole file) — the engine is a pure function of `(available players, roster, rosterSlots, isSF, isDynasty, mode, overall)`. Identical inputs will always produce identical outputs. This was also observed empirically in the Phase 25 mechanics exercise: two different fixture sessions with structurally similar inputs (small resolved pool, similar roster composition) produced the exact same top recommendation each time — consistent with, not contradicting, determinism.

## Ranking stability / tie-breaking

`scored.sort((a, b) => b.totalScore - a.totalScore)` (`RecommendationEngine.ts:360`) — a standard `Array.sort` comparator. **No explicit tie-breaking rule exists** for equal `totalScore` values — JavaScript's `Array.prototype.sort` has been stable since ES2019 (insertion order preserved for equal elements), so ties resolve by the order players appear in the input `available` array, which itself is ADP-ordered upstream. This is an implicit, not explicit, tie-break — functionally deterministic but undocumented as a design decision.

## Confidence calculation

`confidence = clamp(round(55 + totalScore * 0.6), 40, 92)` (`RecommendationEngine.ts:349`) — a real, deterministic, closed-form calculation, not a placeholder or hardcoded constant. Bounded to [40, 92], meaning the engine never reports absolute certainty (92 max) nor absolute rejection (40 min) — a reasonable, honest design choice.

## Explanation quality

`resolveFormatInsight()` (`RecommendationEngine.ts:130-154`) and the `evidence`/`reason` fields produce real, context-derived text (e.g., "Superflex increases QB urgency at this stage", "Dynasty context favors multi-year value over one-week variance") rather than templated filler unrelated to the actual inputs. Confirmed genuine by reading the conditional logic generating each note — text only appears when its triggering condition is actually true for that evaluation.

## Recommendation consistency across rounds — real finding, concerning

In the Phase 25 mechanics exercise (fixture data, see Historical Replay doc for caveats), the SAME top candidate was recommended across 5 consecutive simulated rounds with different stated positional needs (RB→RB→WR→WR→TE). Root-caused to the identity-resolution gap (only 54/272 candidates usable — see Identity Validation doc), not a flaw in the scoring formula itself. **This means: recommendation quality could not be genuinely stress-tested for round-to-round differentiation this phase**, because the available real-data environment didn't have a rich enough resolved candidate pool to exercise it. This is disclosed as an unresolved open question, not a passed or failed test.

## Reproducibility

Given the engine's purity (confirmed above), reproducibility across repeated runs with identical inputs is not in question — verified directly via code inspection, and indirectly via two real backtest runs producing the same result for structurally similar fixture inputs.

## What was NOT measured (disclosed)

Whether recommendations meaningfully differentiate between genuinely different real draft contexts (different real rosters, different real needs, different real ADP distributions) — the one thing that actually matters for "is this a good recommendation engine" — could not be tested this phase due to the zero-real-draft-data constraint documented in the Historical Replay doc. The formula itself is legible, deterministic, and its individual terms (`needScore`, `adpEdge`, `formatBoost`) are each independently sensible in isolation (read directly from source), but end-to-end real-world quality remains unverified.
