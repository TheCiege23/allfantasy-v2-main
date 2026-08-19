/**
 * Fantasy OS Suite — Phase V8.2: activity evidence derivation (pure, engineering-only).
 *
 * Deterministic derivations over the persisted normalized bundle. Evidence ONLY — counts, frequencies,
 * participation, churn, completed FAAB spend. It never infers intent, personality, skill, collusion,
 * tanking, trade-acceptance probability, or any behavioral label. Not customer-facing; no recommendation
 * logic. `null` means "not derivable from the observed evidence", never a fabricated value.
 */
import type { LeagueEvidenceBundle } from './contracts'

export type ActivityEvidence = {
  totalCompletedTrades: number
  managersParticipatingInTrades: number
  weeklyTransactionActivity: Record<number, number>
  waiverFrequency: number
  freeAgentFrequency: number
  rosterChurn: number
  /** Share of roster-weeks that recorded points > 0 (lineup participation evidence); null if no matchups. */
  lineupParticipationRate: number | null
  draftParticipation: { present: boolean; complete: boolean; participatingRosterCount: number }
  /** Sum of FAAB from completed waiver bids; null when the provider supplied no FAAB evidence. */
  completedFaabSpending: number | null
  /** Per league-local roster id → count of transactions it participated in. */
  managerActivityDistribution: Record<number, number>
  /** Count of rosters with zero transaction participation (inactivity evidence). */
  inactiveRosterCount: number
}

export function deriveActivityEvidence(bundle: LeagueEvidenceBundle): ActivityEvidence {
  const trades = bundle.transactions.filter((t) => t.type === 'trade')
  const waivers = bundle.transactions.filter((t) => t.type === 'waiver')
  const freeAgents = bundle.transactions.filter((t) => t.type === 'free_agent')

  const tradeManagers = new Set<number>()
  for (const t of trades) for (const r of t.participatingRosterIds) tradeManagers.add(r)

  const weekly: Record<number, number> = {}
  const perManager: Record<number, number> = {}
  for (const t of bundle.transactions) {
    if (t.week !== null) weekly[t.week] = (weekly[t.week] ?? 0) + 1
    for (const r of t.participatingRosterIds) perManager[r] = (perManager[r] ?? 0) + 1
  }

  const churn = bundle.transactions.reduce((sum, t) => sum + t.addsCount + t.dropsCount, 0)

  const lineupParticipationRate = bundle.matchups.length
    ? bundle.matchups.filter((m) => m.points > 0).length / bundle.matchups.length
    : null

  const faabAvailable = waivers.some((w) => w.faabSpent !== null)
  const completedFaabSpending = faabAvailable
    ? waivers.reduce((sum, w) => sum + (w.faabSpent ?? 0), 0)
    : null

  // Inactivity: rosters (from membership/standings) that participated in no transaction.
  const allRosters = new Set<number>([
    ...bundle.rosterMembership.map((r) => r.rosterId),
    ...bundle.standings.map((s) => s.rosterId),
  ])
  const active = new Set(Object.keys(perManager).map(Number))
  const inactiveRosterCount = [...allRosters].filter((r) => !active.has(r)).length

  return {
    totalCompletedTrades: trades.length,
    managersParticipatingInTrades: tradeManagers.size,
    weeklyTransactionActivity: weekly,
    waiverFrequency: waivers.length,
    freeAgentFrequency: freeAgents.length,
    rosterChurn: churn,
    lineupParticipationRate,
    draftParticipation: {
      present: bundle.draft !== null,
      complete: bundle.draft?.status === 'complete',
      participatingRosterCount: bundle.draft?.participatingRosterCount ?? 0,
    },
    completedFaabSpending,
    managerActivityDistribution: perManager,
    inactiveRosterCount,
  }
}
