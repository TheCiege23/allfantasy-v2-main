/**
 * The core-app Matchup screen, the league home card and the dashboard's live strip read an imported
 * league's week from `WeeklyMatchup`, keyed by the PLATFORM's league and team ids. Those rows are shared
 * with every other user who imported the same league, so AllFantasy never writes its own scores there.
 *
 * Once a league is official, AllFantasy scores it from its own schedule (`RedraftMatchup`, copied in at
 * "Make it official", lib/league/switching/takeOverSchedule.ts). This reads that schedule back in the
 * shape those screens already read: one row per team per game, with the team's platform id
 * (`Roster.playerData.source_team_id`) as `rosterId`, so nothing downstream changes.
 *
 * Null for a league that is not official: the caller reads `WeeklyMatchup` as before.
 *
 * Regular-season weeks only. AllFantasy's playoff bracket lives in `RedraftPlayoffMatchup`, which the
 * League page's Matchup tab reads; a playoff week reads here as having no game stored.
 */
import { prisma } from '@/lib/prisma'
import { isOfficialOnAllFantasy } from './switchingLeague'

export type OfficialWeeklyRow = {
  seasonYear: number
  week: number
  rosterId: string
  matchupId: number
  game: number
  pointsFor: number
  pointsAgainst: number
  /** As `WeeklyMatchup.win`: 1 for a final win, else 0. Nothing reads it as a result; results come from paired scores. */
  win: number
}

export async function loadOfficialWeeklyRows(
  league: { id: string; settings: unknown },
  seasonYear: number,
  filter: { week?: number; rosterIds?: readonly string[] } = {},
): Promise<OfficialWeeklyRow[] | null> {
  if (!isOfficialOnAllFantasy(league.settings)) return null
  const season = await prisma.redraftSeason.findFirst({ where: { leagueId: league.id, season: seasonYear }, select: { id: true } })
  if (!season) return []
  const [matchups, rosters] = await Promise.all([
    prisma.redraftMatchup.findMany({
      where: { seasonId: season.id, isMedianMatchup: false, ...(filter.week != null ? { week: filter.week } : {}) },
      select: { week: true, homeRosterId: true, awayRosterId: true, homeScore: true, awayScore: true, status: true },
      orderBy: [{ week: 'asc' }, { id: 'asc' }],
    }),
    prisma.roster.findMany({ where: { leagueId: league.id, redraftRosterId: { not: null } }, select: { redraftRosterId: true, playerData: true } }),
  ])
  const platformIdOf = new Map(rosters.map((r) => {
    const pd = r.playerData && typeof r.playerData === 'object' ? (r.playerData as Record<string, unknown>) : {}
    return [r.redraftRosterId as string, String(pd.source_team_id ?? '')]
  }))
  const wanted = filter.rosterIds ? new Set(filter.rosterIds) : null
  const out: OfficialWeeklyRow[] = []
  const numberInWeek = new Map<number, number>()
  for (const m of matchups) {
    // A matchup id is only meaningful within its week, as the platform's are.
    const matchupId = (numberInWeek.get(m.week) ?? 0) + 1
    numberInWeek.set(m.week, matchupId)
    const home = platformIdOf.get(m.homeRosterId)
    const away = m.awayRosterId ? platformIdOf.get(m.awayRosterId) : undefined
    const final = m.status === 'final'
    const side = (rosterId: string, pf: number, pa: number): OfficialWeeklyRow => ({
      seasonYear, week: m.week, rosterId, matchupId, game: 1, pointsFor: pf, pointsAgainst: pa, win: final && pf > pa ? 1 : 0,
    })
    if (home && (!wanted || wanted.has(home))) out.push(side(home, m.homeScore, m.awayScore))
    if (away && (!wanted || wanted.has(away))) out.push(side(away, m.awayScore, m.homeScore))
  }
  return out
}
