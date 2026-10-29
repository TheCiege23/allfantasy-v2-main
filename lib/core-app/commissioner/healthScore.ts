import type { SectionState } from '../leagueHome'
import { messagesFor } from '@/lib/i18n/messages'
import { commissionerBuildersMessages } from '../messages/commissionerBuilders'

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
  /** The reader's language for the reasons written here; default English. */
  language?: string
}): HubHealthScore {
  const { snapshot, unread, activityStale, staleDays } = input
  const m = messagesFor(commissionerBuildersMessages, input.language)
  // The only new rule. Everything below it is the hub's previous logic, unchanged.
  if (activityStale) {
    return {
      available: false,
      reason: m.healthScoreStale(staleDays),
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
    reason: unread ? m.healthScoreNeverSynced : m.healthScoreNotEnoughData,
  }
}
