import 'server-only'

import { prisma } from '@/lib/prisma'
import { leagueDisplayName, type SectionState } from './leagueHome'

/**
 * Every league you are in — the inventory the new dashboard does not have.
 *
 * ⚠ THIS IS THE BLOCKER THAT MATTERED MOST IN THE CUTOVER LEDGER. `/core` home is
 * an issues-and-deadlines queue: it takes a league COUNT, not a list. `/dashboard`
 * renders every league with detail and a modal. Redirecting one to the other
 * without this would leave a user with eight leagues no way to see them — the
 * screen would be strictly better at "what needs me now" and would have silently
 * deleted "what do I have".
 *
 * ⚠ THE ROSTER JOIN USES ALL THREE CANDIDATES, and that is not optional. Matching
 * only on LeagueTeam.platformUserId and externalId found a roster for 38 of 106
 * claimed teams; adding the caller's own User uuid takes it to 93, because
 * Roster.platformUserId sometimes holds our uuid rather than the platform's id.
 * Same predicate as myTeam.ts and playerImpact.ts — deliberately, so the three
 * surfaces cannot disagree about which team is yours.
 */

export type PortfolioLeague = {
  leagueId: string
  leagueName: string
  platform: string
  sport: string
  season: string | null
  /** Your team in this league, when we can resolve it. */
  team: {
    name: string
    record: string | null
    rank: number | null
    teamCount: number | null
  } | null
  /** True when you commission this league. */
  isCommissioner: boolean
  /** Roster size we hold, or null when no roster is imported. */
  rosterCount: number | null
}

export type PortfolioData = {
  leagues: SectionState<PortfolioLeague[]>
  commissionedCount: number
}

function recordOf(t: { wins: number; losses: number; ties: number } | null): string | null {
  if (!t) return null
  if (t.wins === 0 && t.losses === 0 && t.ties === 0) return null
  return t.ties > 0 ? `${t.wins}-${t.losses}-${t.ties}` : `${t.wins}-${t.losses}`
}

export async function getPortfolio(userId: string): Promise<PortfolioData> {
  const teams = await prisma.leagueTeam.findMany({
    where: { claimedByUserId: userId },
    select: {
      leagueId: true,
      teamName: true,
      ownerName: true,
      wins: true,
      losses: true,
      ties: true,
      currentRank: true,
      platformUserId: true,
      externalId: true,
      isCommissioner: true,
      league: {
        select: { id: true, name: true, platform: true, sport: true, season: true },
      },
    },
  })

  if (teams.length === 0) {
    return {
      leagues: {
        available: false,
        reason: 'no leagues claimed to your account yet — import one to get started',
      },
      commissionedCount: 0,
    }
  }

  const leagueIds = [...new Set(teams.map((t) => t.leagueId))]
  const counts = await prisma.leagueTeam.groupBy({
    by: ['leagueId'],
    where: { leagueId: { in: leagueIds } },
    _count: { _all: true },
  })
  const teamCountBy = new Map(counts.map((c) => [c.leagueId, c._count._all]))

  const out: PortfolioLeague[] = []
  for (const t of teams) {
    const candidates = [t.platformUserId, t.externalId, userId].filter(Boolean) as string[]
    const roster = await prisma.roster.findFirst({
      where: { leagueId: t.leagueId, platformUserId: { in: candidates } },
      select: { playerData: true },
    })

    /*
     * ⚠ NULL WHEN NO ROSTER IS IMPORTED, NOT 0. Zero would read as an empty team
     * the user needs to fix; null means we never received one, which is an import
     * problem and a different sentence entirely.
     */
    let rosterCount: number | null = null
    if (roster) {
      const pd = (roster.playerData ?? {}) as Record<string, unknown>
      const players = Array.isArray(pd.players) ? pd.players : []
      rosterCount = players.length
    }

    out.push({
      leagueId: t.leagueId,
      leagueName: leagueDisplayName(t.league?.name ?? null),
      platform: String(t.league?.platform ?? 'manual').toLowerCase(),
      sport: String(t.league?.sport ?? 'NFL'),
      season: t.league?.season != null ? String(t.league.season) : null,
      team: t.teamName
        ? {
            name: t.teamName,
            record: recordOf({ wins: t.wins, losses: t.losses, ties: t.ties }),
            rank: t.currentRank ?? null,
            teamCount: teamCountBy.get(t.leagueId) ?? null,
          }
        : null,
      isCommissioner: Boolean(t.isCommissioner),
      rosterCount,
    })
  }

  /*
   * Commissioned leagues first — running a league carries obligations that being
   * in one does not, so those rows are the ones a person is accountable for.
   * Then alphabetical, which is stable across refreshes; sorting by "recent
   * activity" would reshuffle the list under the reader between visits.
   */
  out.sort((a, b) => {
    if (a.isCommissioner !== b.isCommissioner) return a.isCommissioner ? -1 : 1
    return a.leagueName.localeCompare(b.leagueName)
  })

  return {
    leagues: { available: true, data: out },
    commissionedCount: out.filter((l) => l.isCommissioner).length,
  }
}
