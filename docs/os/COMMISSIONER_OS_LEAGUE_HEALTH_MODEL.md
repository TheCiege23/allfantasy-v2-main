# Commissioner OS League Health Model

Date: 2026-07-13. Documents the League Health domain (Part 5) —
`generators/commissioner/leagueHealthRecommendations.ts`.

## The model is reused, not built

The real health score, category, issues, evidence, and confidence all come
from `monitorLeagueHealth()` (the pre-existing, live health engine) via
`lib/shared-services/commissioner/LeagueHealthService.ts`'s
`buildLeagueHealthAssessment()` — already computed once in
`CommissionerOsContext.health`. This generator is a thin mapper: it never
recomputes the score, and narrative generation never determines it either,
per the explicit guardrail. If a future phase wants a different scoring
model, that's a change to `monitorLeagueHealth()` or
`buildLeagueHealthAssessment()`, not to this generator.

## Category → band mapping

The shared service's real 5-category output
(`healthy`/`watch`/`attention_required`/`critical`/`unavailable`) is mapped
onto the phase brief's suggested health-band vocabulary for display:

| Real category | Health band | Priority |
|---|---|---|
| `healthy` | `healthy` | `low` |
| `watch` | `stable` | `medium` |
| `attention_required` | `declining` | `high` |
| `critical` | `at_risk` | `critical` |
| `unavailable` | `insufficient_evidence` | `low` |

`insufficient_evidence` is a real, honest terminal state, not a fallback
score of zero — when the underlying `monitorLeagueHealth()` call reports
`unavailable`, this generator's summary is the real
`health.sourceAttribution.missingDataReason`, never a fabricated number.

## Freshness gating

`isFreshnessSafeForPriority(context.syncFreshness, priority)` — a
`critical` or `high` priority claim (i.e. a `watch`/`critical` category) is
suppressed entirely when the underlying sync data is stale, failed, or
never synced. Only `fresh` or `not_applicable` (native leagues) data may
back a `critical`/`high` league-health claim. Verified by a dedicated test:
a `critical`-category league with stale freshness produces zero
recommendations, not a downgraded-but-still-shown one.

## What is and isn't fabricated

- Never fabricates chat/sentiment metrics — no chat/poll/sentiment field
  exists anywhere in the real context this generator reads; nothing to
  fabricate even if the temptation existed.
- `rationale` is always the real `health.issues` array (or an honest "no
  specific issues flagged" line when empty) — never invented issue text.
- `evidence` entries are always the real `health.evidence` strings,
  labeled `Signal N`, sourced to `monitorLeagueHealth` — never a made-up
  evidence line.
- `confidence` is always `health.confidence / 100` — the real engine's own
  confidence value, never overridden.

## Physical proof

Part 21's disposable-branch validation confirmed two differently-configured
leagues produce genuinely different health output end-to-end through the
real `assembleCommissionerOsRecommendations` coordinator — not just at the
unit-test level. See `COMMISSIONER_OS_CERTIFICATION.md` for the disclosed
scope limits of that specific proof (both fixture leagues shared an
identical Mission-Control-derived score in the real run, since deep
`TeamWeekResult`/`Transaction`-level activity rows were not seeded — the
differentiation actually exercised end-to-end was sync freshness,
rivalries, storylines, and draft grades, not the numeric health score
itself).
