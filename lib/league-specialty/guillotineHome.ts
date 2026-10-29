/**
 * Guillotine league home — the extra, presentation-only data the specialty home needs on top of
 * `buildWeeklySummary` (handoff: design-refs/native-league-handoff/specialty-leagues/guillotine/).
 *
 * Reads only. Uses the guillotine engine's own tables and helpers read-only; it changes no rule and
 * computes no tier — the chop line's tags still come from `getDangerTiers` via the summary.
 *
 *   teamCount / aliveCount   hero chip "14 teams · 9 alive"
 *   chopped                  struck-through chips: name, the week chopped, that week's score
 *   nextChopAt / chopLabel   "Chop locks in" countdown (the sport's chop time, after corrections)
 *   lastChop                 the signature moment: bottom three of the latest chopped week, who
 *                            was chopped, and the released players with their availability
 */
import { prisma } from '@/lib/prisma'
import { resolveRosterDisplayNames } from '@/lib/guillotine/rosterDisplayNames'
import { getGuillotineSportConfig, getNextChopTime, getNextWaiverTime } from '@/lib/guillotine/sportConfig'
import { getDangerTiers } from '@/lib/guillotine/GuillotineDangerEngine'
import { claimedPlayerIds } from '@/lib/guillotine/choppedReleases'

export interface GuillotineHomeChopped {
  rosterId: string
  name: string
  week: number | null
  points: number | null
}

export interface GuillotineHomeRelease {
  playerId: string
  playerName: string
  position: string
  team: string | null
  /** ISO time the player can be claimed; Bid stays disabled before it. */
  availableAt: string | null
  status: string
}

export interface GuillotineHomeLastChop {
  week: number
  /** Lowest three scores that week, lowest LAST (the order the moment shows them). */
  bottom: { rosterId: string; name: string; points: number }[]
  choppedRosterIds: string[]
  releases: GuillotineHomeRelease[]
}

export interface GuillotineHomeExtras {
  season: number | null
  /**
   * The score the danger engine ranked each alive roster on this week (its `projectedPoints`:
   * period points, or its own fallback). The weekly summary drops it; the chop line prints it.
   */
  scores: Record<string, number>
  teamCount: number
  aliveCount: number
  chopped: GuillotineHomeChopped[]
  nextChopAt: string | null
  chopLabel: string | null
  nextWaiversAt: string | null
  waiverLabel: string | null
  lastChop: GuillotineHomeLastChop | null
}

const NAME_FALLBACK = 'A team'

/** Pure: bottom N of a week's scores, lowest last; ties keep input order. */
export function bottomScores<T extends { points: number }>(rows: readonly T[], n = 3): T[] {
  return [...rows].sort((a, b) => a.points - b.points).slice(0, n).reverse()
}

export async function buildGuillotineHomeExtras(
  leagueId: string,
  sport: string,
  weekOrPeriod: number,
  now: Date = new Date(),
): Promise<GuillotineHomeExtras> {
  const [league, rosters, states, danger] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { season: true } }).catch(() => null),
    prisma.roster.findMany({ where: { leagueId }, select: { id: true } }),
    prisma.guillotineRosterState.findMany({
      where: { leagueId, choppedAt: { not: null } },
      select: { rosterId: true, choppedInPeriod: true, choppedAt: true },
      orderBy: { choppedAt: 'asc' },
    }),
    getDangerTiers({ leagueId, weekOrPeriod }).catch(() => []),
  ])

  const choppedWeeks = [...new Set(states.map((s) => s.choppedInPeriod).filter((w): w is number => w != null))]
  const lastWeek = choppedWeeks.length ? Math.max(...choppedWeeks) : null

  const scoreRows = choppedWeeks.length
    ? await prisma.guillotinePeriodScore.findMany({
        where: { leagueId, weekOrPeriod: { in: choppedWeeks } },
        select: { rosterId: true, weekOrPeriod: true, periodPoints: true },
      })
    : []
  const scoreKey = (rosterId: string, week: number) => `${rosterId}:${week}`
  const scoreBy = new Map(scoreRows.map((r) => [scoreKey(r.rosterId, r.weekOrPeriod), r.periodPoints]))

  const lastWeekRows = lastWeek != null ? scoreRows.filter((r) => r.weekOrPeriod === lastWeek) : []
  const bottom = bottomScores(lastWeekRows.map((r) => ({ rosterId: r.rosterId, points: r.periodPoints })))
  const names = await resolveRosterDisplayNames(leagueId, [...states.map((s) => s.rosterId), ...bottom.map((b) => b.rosterId)])
  const nameOf = (id: string) => names.get(id) ?? NAME_FALLBACK

  const chopped: GuillotineHomeChopped[] = states.map((s) => ({
    rosterId: s.rosterId,
    name: nameOf(s.rosterId),
    week: s.choppedInPeriod ?? null,
    points: s.choppedInPeriod != null ? scoreBy.get(scoreKey(s.rosterId, s.choppedInPeriod)) ?? null : null,
  }))

  let lastChop: GuillotineHomeLastChop | null = null
  if (lastWeek != null) {
    const choppedRosterIds = states.filter((s) => s.choppedInPeriod === lastWeek).map((s) => s.rosterId)
    const releaseRows = await prisma.guillotineWaiverRelease
      .findMany({
        where: { leagueId, scoringPeriod: lastWeek },
        select: { playerId: true, playerName: true, position: true, team: true, availableAt: true, releaseStatus: true },
        orderBy: { availableAt: 'asc' },
        take: 40,
      })
      .catch(() => [])
    // Nothing updates a row when a claim lands: a player on a team again reads as claimed.
    const claimed = await claimedPlayerIds(leagueId, releaseRows.map((r) => r.playerId)).catch(() => new Set<string>())
    lastChop = {
      week: lastWeek,
      bottom: bottom.map((b) => ({ ...b, name: nameOf(b.rosterId) })),
      choppedRosterIds,
      releases: releaseRows.map((r) => ({
        playerId: r.playerId,
        playerName: r.playerName,
        position: (r.position || '').toUpperCase(),
        team: r.team ?? null,
        availableAt: r.availableAt ? r.availableAt.toISOString() : null,
        status: claimed.has(r.playerId) ? 'claimed' : r.releaseStatus,
      })),
    }
  }

  const profile = getGuillotineSportConfig(sport)
  const choppedSet = new Set(states.map((s) => s.rosterId))
  return {
    season: typeof league?.season === 'number' ? league.season : null,
    scores: Object.fromEntries(danger.map((d) => [d.rosterId, d.projectedPoints])),
    teamCount: rosters.length,
    aliveCount: rosters.filter((r) => !choppedSet.has(r.id)).length,
    chopped,
    nextChopAt: profile ? getNextChopTime(sport, now).toISOString() : null,
    chopLabel: profile?.chopLabel ?? null,
    nextWaiversAt: profile ? getNextWaiverTime(sport, now).toISOString() : null,
    waiverLabel: profile?.waiverLabel ?? null,
    lastChop,
  }
}
