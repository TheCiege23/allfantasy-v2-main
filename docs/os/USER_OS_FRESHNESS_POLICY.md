# User OS Freshness Policy

Date: 2026-07-12/13. Every `LeagueRecommendation` carries its own
`sourceFreshness` (the same `SyncFreshness` shape every League Hub surface
already uses — not a second freshness type). `isFreshnessSafeForPriority()`
(`userOsRecommendationHelpers.ts`) is the single gate every generator calls
before emitting a `critical` or `high` priority recommendation.

## The rule

```ts
function isFreshnessSafeForPriority(freshness, priority) {
  if (freshness.state === 'fresh' || freshness.state === 'not_applicable') return true
  if (priority === 'critical' || priority === 'high') return false
  return true
}
```

`fresh` and `not_applicable` (native leagues — nothing external to sync)
always pass. `stale`, `syncing`, `failed`, and `never_synced` block any
`critical`/`high` recommendation outright — the generator simply does not
emit it, rather than emitting a downgraded version. `medium`/`low`
priority recommendations are allowed through regardless of freshness state,
since their own real-data evidence (win/loss record, standings) is not
freshness-sensitive the way a live injury status is.

## Concrete, real examples this phase implements

| Rule from the phase brief | Where it's enforced |
|---|---|
| "Do not issue a definitive injury replacement recommendation from stale injury data." | `lineupRecommendations.ts`'s `injured_starter` type is `critical` — suppressed entirely when `context.syncFreshness.state !== 'fresh'`. |
| "Do not recommend a waiver pickup if player availability is stale." | `waiverRecommendations.ts`'s `positional_need` type is `high` — same suppression. |
| "Do not calculate manager psychology from missing transaction history." | Not applicable this phase — no manager-psychology signal was wired into any generator (real `lib/decision-os/behavioral/*` engine already degrades honestly on its own, per this phase's Part 1 inventory; not re-implemented or re-wrapped here). |
| "Do not show a numerical playoff probability when standings or schedule data is incomplete." | `playoffRecommendations.ts` — a `SeasonForecastSnapshot` older than `FORECAST_STALE_AFTER_WEEKS` (2) is treated as stale and the generator falls back to the qualitative, non-numeric path; a completely missing `playoffTeams` setting returns no recommendation at all rather than guessing. |

## What "fresh" means, concretely

Reused unchanged from the League Hub Foundation phase's
`deriveSyncFreshness()`: `fresh` = `lastSyncedAt` within 24 hours. This
phase did not introduce a second, domain-specific staleness threshold for
lineup/waiver/roster — the same 24-hour window governs every domain's
freshness gate. The playoff domain's own, additional 2-week
snapshot-staleness check is a second, explicitly separate threshold (a
`SeasonForecastSnapshot` is generated far less often than a league sync),
documented here rather than silently reusing the 24-hour window where it
would not make sense.

## Suppressed vs. downgraded

This phase's implementation always **suppresses** (does not emit) rather
than **visibly downgrades** a critical/high recommendation under stale
data — a simpler, more conservative choice than building a
"low-confidence" visual variant of every recommendation type. Documented
as a real, deliberate scoping decision: a downgraded-but-still-shown
variant is a real future enhancement, not built this phase.
