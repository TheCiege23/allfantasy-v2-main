import { canFillSlot, lineupSeatsFromSettings } from '@/lib/core-app/slotEligibility'
import type { PortfolioMetric, PortfolioTeam } from './types'

export const leaguePercentile = (rank: number, outOf: number) => outOf > 1 ? Math.round(100 * (outOf - rank) / (outOf - 1)) : null

/** Roster structure, not a second player valuation model. IR/taxi never count as active depth. */
export function rosterStructure(slots: string[] | null, players: Array<{ id: string; position: string | null; reserve: boolean }>): PortfolioMetric[] {
  const seats = slots ? lineupSeatsFromSettings({ roster_positions: slots }) : null
  if (!slots?.length || !seats) return [{ key: 'depth', label: 'Backup coverage', value: null, detail: 'Starting-slot eligibility is unavailable for this format.' }]
  const active = players.filter(p => !p.reserve && p.position).sort((a, b) => a.id.localeCompare(b.id))
  // Bipartite matching avoids assigning a flex player twice or greedily losing overlapping slots.
  const assignment = new Map<string, number>()
  const seatPlayer = new Map<number, string>()
  const seat = (index: number, seen: Set<string>): boolean => {
    for (const p of active) {
      if (seen.has(p.id) || !canFillSlot(slots[index]!, p.position)) continue
      seen.add(p.id)
      const old = assignment.get(p.id)
      if (old == null || seat(old, seen)) { assignment.set(p.id, index); seatPlayer.set(index, p.id); return true }
    }
    return false
  }
  for (let i = 0; i < slots.length; i++) seat(i, new Set())
  const starters = new Set(seatPlayer.values())
  const bench = active.filter(p => !starters.has(p.id))
  const covered = slots.filter(s => bench.some(p => canFillSlot(s, p.position))).length
  return [
    { key: 'slots', label: 'Starting-slot coverage', value: Math.round(100 * seatPlayer.size / slots.length), detail: `${seatPlayer.size} of ${slots.length} required slots can be filled by identified active-roster players; availability and game locks are separate.` },
    { key: 'depth', label: 'Backup coverage', value: Math.round(100 * covered / slots.length), detail: `${covered} of ${slots.length} starting slots have a position-eligible bench alternative in one valid roster assignment. This measures eligibility, not backup quality or simultaneous replacements.` },
  ]
}

/** Stable sorting; no raw point/value comparisons between different league rules or sports. */
export function constructionIndex(t: PortfolioTeam): number | null {
  const by = new Map(t.metrics.map(m => [m.key, m.value]))
  const balance = by.get('balance'), depth = by.get('depth')
  return t.percentile != null && balance != null && depth != null && !t.stale && t.status === 'ready'
    ? Math.round(0.5 * t.percentile + 0.3 * balance + 0.2 * depth) : null
}

export function orderPortfolioTeams(teams: PortfolioTeam[], attention: boolean): PortfolioTeam[] {
  const score = constructionIndex
  return [...teams].sort((a, b) => {
    if (a.sport !== b.sport) return a.sport.localeCompare(b.sport)
    if (!attention) {
      const usable = (t: PortfolioTeam) => t.percentile != null && !t.stale && ['ready', 'partial'].includes(t.status)
      if (usable(a) !== usable(b)) return usable(a) ? -1 : 1
    }
    if (attention) {
      const urgency = (t: PortfolioTeam) => Number((t.metrics.find(m => m.key === 'injuries')?.value ?? 0) > 0) + Number((t.metrics.find(m => m.key === 'slots')?.value ?? 100) < 100) + Number((t.metrics.find(m => m.key === 'lineup_gain')?.value ?? 0) > 0.5)
      const urgent = urgency(b) - urgency(a)
      if (urgent) return urgent
    }
    const av = score(a) ?? a.percentile, bv = score(b) ?? b.percentile
    if (av == null && bv == null) {
      const structure = (t: PortfolioTeam) => t.stale ? -1 : t.metrics.find(m => m.key === 'depth')?.value ?? -1
      const delta = structure(b) - structure(a)
      if (delta) return attention ? -delta : delta
    }
    if (av == null && bv != null) return 1
    if (av != null && bv == null) return -1
    const difference = (bv ?? -1) - (av ?? -1)
    return (attention ? -difference : difference) || a.leagueName.localeCompare(b.leagueName) || a.leagueId.localeCompare(b.leagueId)
  })
}
