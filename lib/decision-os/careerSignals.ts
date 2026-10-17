import { SEVERITY_RANK, type AttentionSignalSeverity, type DecisionOsAttentionSignal } from './attentionSignals'
import type { LegacyStake } from '@/lib/core-app/careerMilestones'
import type { WireLeague } from '@/lib/core-app/careerWireModel'

/**
 * Live-career plan, phase 4 — Career facts as Decision OS attention signals.
 *
 * Same contract as `attentionSignals.ts`: pure, zero I/O, interpret outputs that ALREADY exist and
 * never invent one. The inputs are the Career Wire's per-league sync status (`careerWireModel.ts`)
 * and the Career screen's legacy stakes (`careerMilestones.ts`); both are computed for the Career
 * page already, so a signal here can never disagree with what that page shows.
 *
 * ⚠ LEAGUE IDS ONLY, NEVER NAMES — the Decision OS convention (see `attentionSignals.ts`). A stake
 * is matched to its `League.id` through the Wire's league list; a stake that does not resolve to
 * exactly one league is dropped rather than given a guessed id. Account-wide career milestones are
 * deliberately NOT signals: a signal must belong to a league, and the UI renders an unknown
 * `leagueId` verbatim. They reach the Daily Brief as its legacy line instead.
 */

const SYNC_SEVERITY: Partial<Record<WireLeague['status'], AttentionSignalSeverity>> = {
  attention: 'medium',
  never: 'medium',
  gone: 'medium',
}

const SYNC_TITLE: Partial<Record<WireLeague['status'], string>> = {
  attention: 'League data is out of date',
  never: 'League has never been synced',
  gone: 'League no longer exists on its platform',
}

function syncExplanation(l: WireLeague): string {
  if (l.status === 'gone') return 'The platform reports this league no longer exists, so nothing new will arrive for it.'
  if (l.status === 'never') return 'AllFantasy has not completed a read of this league yet, so advice for it has nothing current to work from.'
  return 'The last read is older than the freshness window, or recent reads have failed. Lineup, waiver and trade advice for this league may be working from old rosters.'
}

export function leagueSyncAttentionSignals(leagues: readonly WireLeague[], now: Date): DecisionOsAttentionSignal[] {
  const out: DecisionOsAttentionSignal[] = []
  for (const l of leagues) {
    const severity = SYNC_SEVERITY[l.status]
    if (!severity) continue
    out.push({
      id: `league_sync_attention:${l.leagueId}`,
      leagueId: l.leagueId,
      type: 'league_sync_attention',
      severity,
      priorityScore: SEVERITY_RANK[severity],
      title: SYNC_TITLE[l.status] ?? 'League data needs attention',
      explanation: syncExplanation(l),
      recommendedAction: l.status === 'gone' ? 'Remove the league or reconnect it from Sync.' : 'Re-sync this league from Sync.',
      timestamp: now.toISOString(),
      source: 'career',
    })
  }
  return out
}

const norm = (s: string) => s.trim().toLowerCase()

/** The `League.id` a stake belongs to: platform + name, then name alone if that is unambiguous. */
export function resolveStakeLeagueId(stake: LegacyStake, leagues: readonly WireLeague[]): string | null {
  const byName = leagues.filter((l) => norm(l.leagueName) === norm(stake.leagueName))
  const exact = byName.filter((l) => l.platform === String(stake.platform).toLowerCase())
  if (exact.length === 1) return exact[0].leagueId
  if (exact.length === 0 && byName.length === 1) return byName[0].leagueId
  return null
}

export function careerTitleStakeSignals(
  stakes: readonly LegacyStake[],
  leagues: readonly WireLeague[],
  now: Date,
): DecisionOsAttentionSignal[] {
  const out: DecisionOsAttentionSignal[] = []
  for (const stake of stakes) {
    const leagueId = resolveStakeLeagueId(stake, leagues)
    if (!leagueId) continue
    out.push({
      id: `career_title_stake:${leagueId}:${stake.ringNumber}`,
      leagueId,
      type: 'career_title_stake',
      severity: 'informational',
      priorityScore: SEVERITY_RANK.informational,
      title: stake.tone === 'streak' ? `A repeat here would be ring #${stake.ringNumber}` : `A title here would be ring #${stake.ringNumber}`,
      explanation: stake.detail,
      // The explanation is the whole statement; there is no action to paraphrase out of it.
      recommendedAction: null,
      timestamp: now.toISOString(),
      source: 'career',
    })
  }
  return out
}

export interface CareerSignalInputs {
  wireLeagues: readonly WireLeague[]
  stakes: readonly LegacyStake[]
  now: Date
}

export function deriveCareerAttentionSignals(input: CareerSignalInputs): DecisionOsAttentionSignal[] {
  return [
    ...leagueSyncAttentionSignals(input.wireLeagues, input.now),
    ...careerTitleStakeSignals(input.stakes, input.wireLeagues, input.now),
  ]
}
