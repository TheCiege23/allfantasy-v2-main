import 'server-only'

/**
 * The teams still alive in a native Guilly league, once its draft is done — whether or not anyone has scored.
 *
 * 🛑 "NO CHOP LINE YET" WAS READ AS "NO SEASON YET" (owner report, 2026-11-24). Chop Watch is null until a
 * team scores this week, on purpose (./chopWatch.ts: an all-zero board would rank teams by tiebreak and
 * call that a chop zone), and the danger engine's fallback is empty until a week has been chopped. So
 * between the draft and the first point — the whole first chop week's pre-game window, and every week
 * before chops start — the summary carried no teams at all. What's Next then said "The season has not
 * started · Run the draft" to a league that had drafted, and the Matchup board said the chop line
 * "appears once the season has started".
 *
 * This answers the question those surfaces were really asking: who is in the field. It needs the season
 * (a `RedraftSeason` row exists only once the draft finalizes), maps each surviving redraft roster to its
 * league roster exactly as the chop preview does (./chopPreviewLoad.ts), and leaves out chopped teams.
 * Empty before the draft. Never throws.
 */
import { prisma } from '@/lib/prisma'
import { rosterIdForOwner } from './finishGuillotineSeason'
import { resolveRosterDisplayNames } from './rosterDisplayNames'

export type GuillotineFieldTeam = { rosterId: string; displayName: string }

export async function loadGuillotineField(leagueId: string): Promise<GuillotineFieldTeam[]> {
  try {
    const season = await prisma.redraftSeason.findFirst({ where: { leagueId }, orderBy: { createdAt: 'desc' }, select: { id: true } })
    if (!season) return []
    const [active, rosters, choppedStates] = await Promise.all([
      prisma.redraftRoster.findMany({ where: { seasonId: season.id, isEliminated: false }, select: { id: true, ownerId: true } }),
      prisma.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true, redraftRosterId: true } }),
      prisma.guillotineRosterState.findMany({ where: { leagueId, choppedAt: { not: null } }, select: { rosterId: true } }),
    ])
    const chopped = new Set(choppedStates.map((c) => c.rosterId))
    const ids: string[] = []
    for (const r of active) {
      const id = rosters.find((x) => x.redraftRosterId === r.id)?.id ?? rosterIdForOwner(r.ownerId, rosters)
      if (id && !chopped.has(id) && !ids.includes(id)) ids.push(id)
    }
    if (ids.length === 0) return []
    const names = await resolveRosterDisplayNames(leagueId, ids).catch(() => new Map<string, string>())
    return ids.map((rosterId) => ({ rosterId, displayName: names.get(rosterId) ?? 'A team' }))
  } catch {
    return []
  }
}
