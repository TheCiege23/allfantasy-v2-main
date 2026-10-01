import type { SectionState } from '../leagueHome'

/** The parts of a stored league-health snapshot the hub reads. */
export interface HubHealthSnapshot {
  source: string
  dataConfidence: string
  healthScore: number
  overallStatus: string
  summary: string
  confidencePct: number
}

export type HubHealthScore = SectionState<{ score: number; status: string; summary: string; confidencePct: number }>

/**
 * Whether the hub shows the canonical league-health score, and if not, why.
 *
 * 🛑 A STALE IMPORT IS NOT SCORED. The engine's score leans on manager activity, and a league whose
 * last sync is days old has no recent moves on file — so every manager reads as inactive and the
 * score collapses. Measured 2026-10-01 on a Sleeper league last read 26 days earlier: "4/100
 * (critical). Problem: 11 inactive managers", on the same page where member activity correctly
 * refused to judge that data ("every manager would look idle. Re-sync it"). One page, two verdicts
 * on one dataset. Withholding the score is the same rule member activity already follows.
 */
export function resolveHubHealthScore(input: {
  snapshot: HubHealthSnapshot | null
  /** An imported league nobody has read yet. */
  unread: boolean
  /** True when `staleActivityReason` says the imported activity is too old to judge. */
  activityStale: boolean
  staleDays: number
}): HubHealthScore {
  const { snapshot, unread, activityStale, staleDays } = input
  // The only new rule. Everything below it is the hub's previous logic, unchanged.
  if (activityStale) {
    return {
      available: false,
      reason: `Not scored: AllFantasy last read this league ${staleDays} days ago, and a score built on that data would call every quiet manager inactive. Re-sync it to score the league.`,
    }
  }
  if (snapshot && snapshot.source === 'database' && snapshot.dataConfidence !== 'low') {
    return {
      available: true,
      data: {
        score: snapshot.healthScore,
        status: snapshot.overallStatus,
        summary: snapshot.summary,
        confidencePct: snapshot.confidencePct,
      },
    }
  }
  return {
    available: false,
    reason: unread
      ? 'This league has never synced, so there is nothing to score yet.'
      : 'There isn’t enough roster and activity data to score this league yet.',
  }
}
