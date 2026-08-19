# Draft Recommendation Engine — Fresh Audit (Phase 29)

**Status: re-verified fresh from source this phase, not trusted from Phase 25's documentation.**

## Exact scoring computation (`lib/draft-helper/RecommendationEngine.ts`), pre-Phase-29

```
needScore    = computeNeeds() -- roster-composition-based, 0-100 scale, real
adpEdge      = clamp((overall - adp) * 1.4, -20, 25) -- real ADP-vs-pick-position signal
formatBoost  = +14 if NFL && Superflex && position===QB
               +4  if NFL && position===TE && roster template includes a TE slot
totalScore   = (mode==='bpa' ? 0 : needScore * 0.55) + adpEdge * 0.9 + formatBoost
confidence   = clamp(round(55 + totalScore * 0.6), 40, 92)
```

Confirmed fresh: no `scoringFormat` field existed anywhere in `RecommendationInput` before this phase (grep returned zero matches). `isDynasty` was read only inside `resolveFormatInsight()`, which appends a static explanation sentence — confirmed it had **zero** effect on `needScore`, `adpEdge`, `formatBoost`, or `totalScore` before this phase (verified by direct code trace, not assumed).

## Explanations

`resolveFormatInsight()`, `resolveCorrelationInsights()`, and the `reasonParts`/`evidence` arrays in `computeDraftRecommendation()` build real, context-derived text (verified: each note only appears when its triggering condition is genuinely true for that evaluation) — confirmed accurate in Phase 25, reconfirmed unchanged this phase except for the new Phase 29 scoring signals now also being real (previously Dynasty's note was the *only* Dynasty signal; now it accompanies a real scoring effect too).

## Zero existing unit tests

A repo-wide search (`__tests__/**`) for any test importing `computeDraftRecommendation`/`computeDraftPlayerRankings` directly found **zero** dedicated tests for this engine before this phase — only `__tests__/shared-services/draft/draft-shadow-service.test.ts`, which mocks the engine out entirely rather than testing it. This phase adds the first direct unit tests for this real, live, heavily-used engine (`__tests__/draft-helper/recommendation-engine-scoring-dynasty.test.ts`, 8 tests).

## What this phase extended (not redesigned)

Two new, real, deterministic scoring terms added to the same `totalScore` formula, following the exact same additive pattern `formatBoost` already used:

```
formatBoost += scoringFormatBoost(position, scoringFormat)  -- NFL only, position-level, real
dynastyBoost = dynastyAgeAdjustment(player.age, isDynasty)  -- only when isDynasty===true
totalScore   = ...(unchanged)... + formatBoost + dynastyBoost
```

Both default to zero effect when the new optional fields (`scoringFormat`, `age`) are omitted — confirmed via a passing backward-compatibility test (`defaults to standard (no boost) when scoringFormat is omitted`).
