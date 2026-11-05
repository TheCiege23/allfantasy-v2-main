import 'server-only'
import { resolveCanonicalWorld } from '@/lib/decision-os/world'
import { resolveNames } from '@/lib/ai-payload/resolveAiTeamContext'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { activePlayerIds, viewerRosterOf } from '@/lib/chimmy/leagueRosterIndex'
import { isForeignIdSpace } from '@/lib/core-app/rosterIdSpace'
import { isUnbridgedId } from '@/lib/core-app/bridgedRosterIds'
import { leagueWeekBasis, isLeagueWeekRefusal, priceLeagueWeek } from '@/lib/decision-os/trade/leagueWeekPricing'
import { fillLineup } from '@/lib/decision-os/trade/rosterImpact'
import { enrichLineupAvailability, unavailableForLineup } from '@/lib/chimmy/lineupAvailability'
import { canFillSlot } from '@/lib/core-app/slotEligibility'

/** Same weekly component scoring and lineup fill as Trade Center. No raw-point comparison across leagues. */
export async function weeklyLeagueStrength(leagueId: string, userId: string): Promise<{ rank: number; outOf: number; points: number; detail: string; weakest: { position: string; rank: number; outOf: number } | null } | null> {
  const world = await resolveCanonicalWorld(leagueId)
  if (!world || world.league.sport !== 'NFL') return null
  const mine = viewerRosterOf(world, userId)
  if (!mine) return null
  const byTeam = new Map<string, typeof mine>()
  for (const r of world.rosters) {
    const key = r.teamId ?? r.rosterId
    const held = byTeam.get(key)
    if (held && JSON.stringify([...held.playerIds].sort()) !== JSON.stringify([...r.playerIds].sort())) return null
    byTeam.set(key, r)
  }
  const rosters = [...byTeam.values()]
  const ids = [...new Set(rosters.flatMap(activePlayerIds))]
  if (rosters.length < 3 || world.league.teamCount != null && rosters.length !== world.league.teamCount || !ids.length || ids.length > 1500 ||
      isForeignIdSpace(world.provenance?.provider) && ids.some(isUnbridgedId)) return null
  const slots = world.league.rosterSettings.starterSlots
  if (!slots?.length) return null
  const basis = await leagueWeekBasis(world.league)
  if (isLeagueWeekRefusal(basis) || Number(basis.week.season) !== world.league.season) return null
  const names = await enrichLineupAvailability(world.league.sport, await resolveNames(normalizeToSupportedSport(world.league.sport), ids, 1500))
  const positions = new Map(ids.map(id => [id, names.get(id)?.position ?? null]))
  const priced = await priceLeagueWeek(basis, ids, positions)
  for (const id of ids) {
    const entry = priced.get(id)
    if (entry && unavailableForLineup(names.get(id)?.injury)) priced.set(id, { ...entry, projectedPoints: 0 })
  }
  // A league ranking needs the same coverage for every opponent, not only the asker's roster.
  if (ids.some(id => !positions.get(id) || priced.get(id)?.projectedPoints == null)) return null
  const totals = rosters.map(r => ({ id: r.rosterId, fill: fillLineup(activePlayerIds(r).map(id => priced.get(id)!), slots) }))
  if (totals.some(t => t.fill.unfilledSlots.length || t.fill.unknownSlots.length)) return null
  const own = totals.find(t => t.id === mine.rosterId)
  if (!own) return null
  const positionStrength = [...new Set(activePlayerIds(mine).map(id => positions.get(id)).filter((p): p is string => Boolean(p)))].filter(p => slots.some(slot => canFillSlot(slot, p))).map(position => {
    const sum = (r: typeof mine) => activePlayerIds(r).filter(id => positions.get(id) === position).reduce((n, id) => n + priced.get(id)!.projectedPoints!, 0)
    const value = sum(mine)
    return { position, rank: 1 + rosters.filter(r => sum(r) > value).length, outOf: rosters.length }
  }).sort((a, b) => b.rank - a.rank || a.position.localeCompare(b.position))
  return { rank: 1 + totals.filter(t => t.fill.points > own.fill.points).length, outOf: totals.length, points: own.fill.points,
    weakest: positionStrength[0] ?? null,
    detail: 'Week ' + basis.week.week + ', ' + basis.week.season + ': hypothetical optimal full-week projections under this league’s rules. These are not remaining points or lock-checked lineup changes.' }
}
