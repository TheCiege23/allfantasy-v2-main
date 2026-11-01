import type { NativeWeekResult } from './ZombieInfectionEngine'

export const BETA_2025_WINNINGS_SOURCE = 'weekly_settlement_2025'
export const BETA_2025_WINNINGS_POLICY = 'beta_2025' as const
export type Beta2025WinningsContext = {
  policy: typeof BETA_2025_WINNINGS_POLICY
  thresholds?: { bashingThreshold: number; maulingThreshold: number }
  openingByRoster: Record<string, number>
  statusByRoster: Record<string, string>
}
export type Beta2025Transfer = {
  matchupId: string; fromRosterId: string; toRosterId: string; amount: number
  kind: 'infection' | 'mauling' | 'bashing' | 'weekly_loot'
}

function role(value: string | undefined): 'survivor' | 'zombie' | 'whisperer' {
  const s = value?.trim().toLowerCase()
  if (s === 'survivor' || s === 'revived' || s === 'revived survivor') return 'survivor'
  if (s === 'zombie' || s === 'whisperer') return s
  throw new Error('ZOMBIE_WINNINGS_STATUS_REQUIRED')
}
const cents = (value: number) => {
  if (!Number.isFinite(value) || value < 0) throw new Error('ZOMBIE_WINNINGS_INVALID_BALANCE')
  return Math.round(value * 100)
}

/** Deltas to the cumulative winnings ledger, using roles and balances BEFORE settlement. */
export function computeBeta2025Winnings(
  results: readonly NativeWeekResult[],
  context: Beta2025WinningsContext,
  thresholds: { bashingThreshold: number; maulingThreshold: number },
): { netByRoster: Map<string, number>; transfers: Beta2025Transfer[] } {
  const net = new Map<string, number>()
  const transfers: Beta2025Transfer[] = []
  const seen = new Set<string>()
  for (const r of results) {
    if (!r.final || !r.homeRosterId || !r.awayRosterId) continue
    if (![r.homeScore, r.awayScore].every(Number.isFinite)) throw new Error('ZOMBIE_WINNINGS_INVALID_SCORE')
    for (const id of [r.homeRosterId, r.awayRosterId]) {
      if (seen.has(id)) throw new Error('ZOMBIE_WINNINGS_DUPLICATE_MATCHUP')
      seen.add(id)
      if (!Object.prototype.hasOwnProperty.call(context.openingByRoster, id)) throw new Error('ZOMBIE_WINNINGS_OPENING_BALANCE_REQUIRED')
      cents(context.openingByRoster[id])
      role(context.statusByRoster[id])
      net.set(id, 0)
    }
    if (r.homeScore === r.awayScore) continue
    const homeWon = r.homeScore > r.awayScore
    const winner = homeWon ? r.homeRosterId : r.awayRosterId
    const loser = homeWon ? r.awayRosterId : r.homeRosterId
    const w = role(context.statusByRoster[winner])
    const l = role(context.statusByRoster[loser])
    if (w === 'whisperer' && l === 'whisperer') throw new Error('ZOMBIE_WINNINGS_WHISPERER_PAIR_REVIEW_REQUIRED')
    const margin = Math.round(Math.abs(r.homeScore - r.awayScore) * 100) / 100
    const available = cents(context.openingByRoster[loser])
    let take = 0
    let kind: Beta2025Transfer['kind'] = 'weekly_loot'
    if (w === 'survivor') {
      net.set(winner, l === 'survivor' ? 200 : l === 'zombie' ? 400 : 600)
      if (margin >= thresholds.bashingThreshold) { take = available; kind = 'bashing' }
    } else {
      if (w === 'whisperer' || l !== 'zombie') {
        take = available
        kind = l === 'survivor' ? 'infection' : 'weekly_loot'
      } else {
        take = Math.min(available, Math.ceil(margin) * 100)
      }
      if (w === 'zombie' && margin >= thresholds.maulingThreshold) { take = available; kind = 'mauling' }
    }
    if (take > 0) {
      net.set(winner, (net.get(winner) ?? 0) + take)
      net.set(loser, -take)
      transfers.push({ matchupId: r.matchupId, fromRosterId: loser, toRosterId: winner, amount: take / 100, kind })
    }
  }
  return { netByRoster: new Map([...net].map(([id, amount]) => [id, amount / 100])), transfers }
}

/** Old snapshots keep their original policy. Malformed new snapshots must never fall back. */
export function beta2025ContextFromSnapshot(value: unknown): Beta2025WinningsContext | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const s = value as { winnings?: { policy?: string; openingByRoster?: Record<string, number> }; rules?: { bashingThreshold: number; maulingThreshold: number }; teams?: Array<{ rosterId: string; status: string }> }
  if (!s.winnings) return undefined
  if (s.winnings.policy !== BETA_2025_WINNINGS_POLICY || !s.winnings.openingByRoster ||
      !Array.isArray(s.teams) || !s.rules || !Number.isFinite(s.rules.bashingThreshold) || !Number.isFinite(s.rules.maulingThreshold) || s.rules.bashingThreshold <= 0 || s.rules.maulingThreshold <= 0) throw new Error('ZOMBIE_WINNINGS_SNAPSHOT_INVALID')
  const openingByRoster = s.winnings.openingByRoster
  if (Object.values(openingByRoster).some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0)) {
    throw new Error('ZOMBIE_WINNINGS_SNAPSHOT_INVALID')
  }
  return { policy: BETA_2025_WINNINGS_POLICY, openingByRoster, thresholds: s.rules,
    statusByRoster: Object.fromEntries(s.teams.map(t => [t.rosterId, t.status])) }
}
