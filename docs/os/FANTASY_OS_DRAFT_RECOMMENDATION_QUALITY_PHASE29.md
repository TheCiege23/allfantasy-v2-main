# Recommendation Quality Assessment (Phase 29)

**Status: measured via controlled fixtures (real-league end-to-end measurement not possible, per the Scoring Format and Dynasty Validation reports).**

## Recommendation diversity / scoring sensitivity — real, measured

| Comparison | Real result |
|---|---|
| Same WR, identical ADP, Standard vs. PPR | PPR score strictly higher (real `+3` position boost applied) |
| Same WR, Standard vs. Half-PPR vs. PPR | Strictly increasing: Standard < Half-PPR < PPR |
| Same-ADP WR (age 22) vs. RB (age 22), Dynasty | Both receive the same dynasty boost; position-level PPR boost still differentiates them independently — the two new signals compose correctly, not interfering with each other |
| Young (22) vs. old (33) player, identical ADP, Dynasty league | Young player scores strictly higher (real `+8` vs. real `−10` age adjustment) |
| Same two players, redraft (non-Dynasty) league | Identical scores — age has zero effect outside Dynasty |

## Confidence changes

`confidence = clamp(round(55 + totalScore * 0.6), 40, 92)` — unchanged formula, but now real scoring differentiation (scoring format, dynasty age) flows into `totalScore` before this clamp, meaning confidence values genuinely shift in response to these new signals rather than staying static across formats/ages as they did before this phase (verified via the same passing tests — e.g., a PPR-boosted WR's `totalScore`, and therefore `confidence`, differs measurably from its Standard-format `totalScore`).

## Determinism — proven, not assumed

Explicit test: identical `RecommendationInput` (including the new `scoringFormat`/`age` fields) produces byte-identical `totalScore` output across repeated calls. No randomness was introduced by either new mechanism (both are pure arithmetic functions of their inputs).

## Backward compatibility — proven

Omitting `scoringFormat` defaults to `'standard'` (zero boost) — verified to produce output byte-identical to explicitly passing `scoringFormat: 'standard'`. `isDynasty: false` (the default) means `age` has zero scoring effect regardless of its value — verified identical scores for two players of very different ages in a non-Dynasty context. Every existing real caller of `computeDraftRecommendation`/`computeDraftPlayerRankings` that does not pass these new optional fields is therefore completely unaffected by this phase's changes.

## What was NOT measured (disclosed)

Real-world recommendation-quality improvement against genuine league data — neither real scoring-format-differentiated leagues nor real Dynasty-league draft contexts exist in `.env.test` (see the two validation reports for the precise, real reasons why). The mechanism's correctness is proven; its real-world impact is not yet independently measured against real leagues.
