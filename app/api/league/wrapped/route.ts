import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const league = gate.league
  const factLeagueIds = [...new Set([league.id, league.platformLeagueId].filter(Boolean))]
  const season = league.season
  const [team, transactionGroups, draftPicks, nativeTrades, rosterMoves, standings, profile] = await Promise.all([
    prisma.leagueTeam.findFirst({
      where: { leagueId, OR: [{ claimedByUserId: userId }, { platformUserId: userId }] },
      select: { externalId: true, legacyRosterId: true, currentRank: true, wins: true, losses: true, ties: true, isCommissioner: true, isCoCommissioner: true },
    }),
    prisma.transactionFact.groupBy({
      by: ['type'],
      where: { leagueId: { in: factLeagueIds }, season },
      _count: { _all: true },
    }).catch(() => []),
    prisma.draftFact.count({ where: { leagueId: { in: factLeagueIds }, season } }).catch(() => 0),
    prisma.afLeagueTrade.count({ where: { leagueId } }).catch(() => 0),
    prisma.afRosterMoveHistory.count({ where: { leagueId, season } }).catch(() => 0),
    prisma.seasonStandingFact.findMany({
      where: { leagueId: { in: factLeagueIds }, season },
      orderBy: [{ rank: 'asc' }, { pointsFor: 'desc' }],
      take: 100,
      select: { teamId: true, wins: true, losses: true, ties: true, pointsFor: true, rank: true },
    }).catch(() => []),
    prisma.userProfile.findUnique({ where: { userId }, select: { sleeperUsername: true } }).catch(() => null),
  ])

  const byType = new Map(transactionGroups.map((row) => [row.type.toLowerCase(), row._count._all]))
  const providerTrades = [...byType.entries()]
    .filter(([type]) => type.includes('trade'))
    .reduce((sum, [, count]) => sum + count, 0)
  const acquisitions = [...byType.entries()]
    .filter(([type]) => /add|waiver|free_agent|claim/.test(type))
    .reduce((sum, [, count]) => sum + count, 0)
  const commissioner = league.userId === userId || Boolean(team?.isCommissioner || team?.isCoCommissioner)

  let bestTrade: { partner: string | null; differential: number | null; season: number } | null = null
  if (profile?.sleeperUsername && league.platformLeagueId) {
    const history = await prisma.leagueTradeHistory.findUnique({
      where: { sleeperLeagueId_sleeperUsername: { sleeperLeagueId: league.platformLeagueId, sleeperUsername: profile.sleeperUsername } },
      select: { id: true },
    }).catch(() => null)
    if (history) {
      const trade = await prisma.leagueTrade.findFirst({
        where: { historyId: history.id },
        orderBy: [{ valueDifferential: 'desc' }, { tradeDate: 'desc' }],
        select: { partnerName: true, valueDifferential: true, season: true },
      }).catch(() => null)
      if (trade) bestTrade = { partner: trade.partnerName, differential: trade.valueDifferential, season: trade.season }
    }
  }

  const ownStanding = standings.find((row) => row.teamId === team?.externalId) ?? null
  const rank = ownStanding?.rank ?? team?.currentRank ?? null
  const teamCount = league.leagueSize ?? standings.length
  const outlook = rank == null
    ? 'Import standings and current rosters to unlock a next-season outlook.'
    : rank <= Math.max(1, Math.ceil(teamCount * 0.25))
      ? 'Contender: preserve weekly ceiling and use depth to target one difference-maker.'
      : rank <= Math.max(1, Math.ceil(teamCount * 0.6))
        ? 'In the mix: target lineup upgrades without draining future draft flexibility.'
        : league.isDynasty
          ? 'Retool: prioritize young assets and picks while protecting cornerstone players.'
          : 'Reset: review draft misses and target a stronger weekly floor next season.'

  return NextResponse.json({
    season,
    manager: {
      record: ownStanding ? `${ownStanding.wins}-${ownStanding.losses}${ownStanding.ties ? `-${ownStanding.ties}` : ''}` : team ? `${team.wins}-${team.losses}${team.ties ? `-${team.ties}` : ''}` : null,
      rank,
      moves: team?.legacyRosterId
        ? await prisma.afRosterMoveHistory.count({ where: { leagueId, season, rosterId: team.legacyRosterId } }).catch(() => 0)
        : 0,
      trades: providerTrades + nativeTrades,
      draftPicks,
      bestTrade,
      outlook,
    },
    commissioner: commissioner ? {
      teams: teamCount,
      trades: providerTrades + nativeTrades,
      rosterChanges: rosterMoves + acquisitions,
      draftPicks,
      leader: standings[0] ? { teamId: standings[0].teamId, record: `${standings[0].wins}-${standings[0].losses}`, pointsFor: standings[0].pointsFor } : null,
    } : null,
  })
}
