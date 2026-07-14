# Insufficient-Data Handling Report (Phase 36, Part 5)

## Contract reused, not invented

`ManagerRetentionRisk` gained one new additive value, `'insufficient_data'`, alongside the existing `'low'|'medium'|'high'|'critical'`. No new behavioral model, no new type hierarchy — the existing `retentionRisk`/`retentionRiskReasons` fields on `UserOsTeamHealth`/`ManagerBehavioralIntelligence` carry the new state exactly as they already carry the other four.

This mirrors the exact existing degradation-state pattern `leagueTrend` (`{available: false, reason: 'no_snapshots' | 'insufficient_history'}`) already established in this same module — the new value is additive to an existing enum rather than a parallel new mechanism.

## Where it flows

1. `lib/decision-os/behavioral/manager-intelligence.ts` — `computeRetentionRisk` produces it (see Truthfulness Audit for the exact logic).
2. `lib/decision-os/userOs.ts` — passes through unchanged (`teamHealth.retentionRisk`), no changes needed.
3. `lib/decision-os/managerCommandCenter.ts` — new `insufficientDataLeagueCount` bucket, excluded from both `healthyLeagueCount` and `atRiskLeagueCount`.
4. `lib/decision-os/attentionSignals.ts` — automatically excluded from `manager_engagement_risk` signals (safe lookup-map pattern, zero code change needed).
5. `lib/decision-os/behavioral/api/contracts.ts` — `ManagerIntelligenceV1`/`ManagerSummaryV1` (the public Intelligence API contracts) widened to include the new value — real API consumers now see the honest state instead of a type error or a silently-narrowed value.
6. `lib/decision-os/behavioral/platform-intelligence.ts` — `buildRetentionDistribution`'s internal counter defensively tracks the new value (excluded from all 4 existing public percentage buckets, not exposed as a 5th public bucket — kept narrowly scoped, since widening that platform-wide aggregate's public contract was not one of the three verified Phase 35 gaps).
7. `components/decision-os/UserOsCard.tsx` — renders "Insufficient data" (a new label map entry), never the raw `insufficient_data` string, with a visually muted (not alarming) treatment distinct from `critical`/`high`.

## What was deliberately NOT done (scope discipline)

- `participationTier`'s `'inactive'` value and `isInactive`/`inactivityWarning` fields were **not** touched at the `deriveManagerBehavioralIntelligence` level — they remain legitimate "no activity in the lookback window" signals in their own right, not re-purposed. Only the customer-facing retention-risk classification (`retentionRisk`) and its one real downstream consumer bucketing (`managerCommandCenter.ts`) were fixed, since those are the two places that combine into an alarming, confidently-stated classification. `computeNudges`'s `nudge_never_engaged` critical nudge was left unchanged — confirmed it is not rendered anywhere in Manager OS's real UI (`UserOsCard.tsx`/`ManagerCommandCenterSection.tsx` don't expose `nudges` at all), so it carries no current customer-facing truthfulness risk.
- No new top-level UI stat chip was added for "leagues with insufficient data" in `ManagerCommandCenterSection.tsx`'s Multi-League Overview — the per-league `UserOsCard` truthfully shows the state, and the aggregate bucket count exists in the data contract (`insufficientDataLeagueCount`) for any future consumer; adding new aggregate UI surface was judged to risk "expanding the intelligence model" beyond this phase's three verified gaps.
