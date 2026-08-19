# Retention-Risk Truthfulness Audit (Phase 36, Part 4)

## Root cause, traced precisely (not inferred)

`lib/decision-os/behavioral/manager-intelligence.ts`'s `computeRetentionRisk()`:

```ts
if (facts.eventCount === 0) {
  return { risk: 'critical', reasons: ['Manager has never taken any recorded action in the league'] }
}
```

`facts.eventCount` is THIS manager's own event count only. Before this phase, ANY manager with zero personal events was unconditionally `'critical'` — with no distinction between "the league itself has zero recorded activity for anyone" (a data-coverage gap) and "everyone else in this league is active except this manager" (real, relative evidence of disengagement).

## Decision table — how each state was classified before this phase

| Real-world state | `facts.eventCount` | League-wide `events.length` | Old classification | Correct? |
|---|---|---|---|---|
| Confirmed inactivity (others active, this manager isn't) | 0 | > 0 | `critical` | **Yes** — real evidence |
| No imported activity at all (pipeline/data gap) | 0 | 0 | `critical` | **No** — no evidence either way |
| No behavioral snapshot captured yet | n/a (separate signal) | n/a | `leagueTrend.available: false, reason: 'no_snapshots'` | Already correctly separate — not conflated with retention risk |
| Insufficient observation window | n/a | n/a | Not a distinct state — `lookbackDays` narrows the window but doesn't flag insufficiency | Out of this phase's narrow scope (disclosed, not fixed) |
| Genuinely high-risk behavior (inactive 14-28+ days, no lineup saves) | > 0 | > 0 | `high`/`critical` via `daysSinceLastActivity`/`lineupSaveCount` checks | **Yes** — unaffected by this phase, already evidence-based |

**The single real conflation found and fixed**: rows 1 and 2 were indistinguishable before this phase — both produced identical `critical` output despite representing opposite epistemic states (real evidence vs. no evidence).

## Fix

`computeRetentionRisk` now receives `leagueEventCount` (the already-available, unfiltered league-wide `events` array length — no new data fetch, no new parameter threading through any external caller, since all 4 real callers already pass the full league-wide array). When `facts.eventCount === 0`:
- `leagueEventCount === 0` → new `'insufficient_data'` risk, honest reason, never described as confirmed disengagement.
- `leagueEventCount > 0` → unchanged `'critical'`, real relative evidence.

A second, related conflation was found downstream during real validation (Part 7): `managerCommandCenter.ts`'s healthy/at-risk bucketing OR'd in `teamHealth.isInactive` regardless of `retentionRisk`, silently reintroducing the same bug at the aggregation layer even after the core fix. Fixed by adding a 4th bucket, `insufficientDataLeagueCount`, checked before the at-risk OR-condition — `totalLeagues` is still always the sum of all four buckets (no silent count mismatch, matching this file's own established OS-C3 discipline).

`attentionSignals.ts`'s `manager_engagement_risk` signal generator required **no fix** — it was already written as a safe lookup (`MANAGER_RETENTION_SEVERITY[risk]`, absent key → no signal) rather than an exhaustive if/else, so the new `insufficient_data` value was automatically and correctly excluded the moment the type existed.
