import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { buildRosterIdMap } from '@/lib/core-app/rosterIdMatch'
import {
  NATIVE_COMPLETED_TRADE_STATUS,
  countCompletedTrades,
  loadTradeFacts,
  summarizeTradeHistory,
  type TradeFactRow,
} from '@/lib/trade-intel/partnerHistory'

export const dynamic = 'force-dynamic'

/**
 * Every AF `leagues` row that IS this provider league — one per importing user. Facts attach to
 * whichever row synced, so reading only this row can find none of the viewer's history. Matched on
 * platform AND external id, so the same digits on another provider never count.
 */
async function siblingLeagueIds(league: { id: string; platform: string | null; platformLeagueId: string | null }): Promise<string[]> {
  if (!league.platform || !league.platformLeagueId) return [league.id]
  const rows = await prisma.league
    .findMany({ where: { platform: league.platform, platformLeagueId: league.platformLeagueId }, select: { id: true } })
    .catch(() => [] as Array<{ id: string }>)
  return [...new Set([league.id, ...rows.map((r) => r.id)])]
}

/**
 * When a NATIVE league played `season`. `AfLeagueTrade` carries no season, and a native league keeps
 * one `leagues` row across years (renewal advances `season` in place), so a trade's season is read
 * from when it was processed: after the league completed the season before (its `LeagueSeason` row,
 * written at completion or renewal) and no later than this season's own completion, when there is one.
 * No earlier completed season means the league has no earlier season, so there is no lower bound.
 */
async function nativeSeasonWindow(leagueId: string, season: number): Promise<{ gt?: Date; lte?: Date }> {
  const done = await prisma.leagueSeason
    .findMany({ where: { leagueId, status: 'complete', season: { lte: season } }, select: { season: true, createdAt: true } })
    .catch(() => [] as Array<{ season: number; createdAt: Date }>)
  const before = done.filter((r) => r.season < season).map((r) => r.createdAt.getTime())
  const own = done.find((r) => r.season === season)
  return {
    ...(before.length ? { gt: new Date(Math.max(...before)) } : {}),
    ...(own ? { lte: own.createdAt } : {}),
  }
}

type SeasonTrades = {
  facts: TradeFactRow[]
  native: Array<{ id: string; proposerRosterId: string; receiverRosterId: string }>
}

/**
 * The league's completed trades this season, read ONCE for both editions: trade fact rows across
 * every sibling importer row, and native trades processed inside the season's window. Both counts
 * below read this same set, so "My team" can never exceed the league total.
 */
async function loadSeasonTrades(args: { leagueId: string; factLeagueIds: string[]; season: number }): Promise<SeasonTrades> {
  const window = await nativeSeasonWindow(args.leagueId, args.season)
  const [facts, native] = await Promise.all([
    loadTradeFacts({ leagueIds: args.factLeagueIds, season: args.season }).catch(() => [] as TradeFactRow[]),
    prisma.afLeagueTrade
      .findMany({
        where: {
          leagueId: args.leagueId,
          status: NATIVE_COMPLETED_TRADE_STATUS,
          OR: [{ processedAt: window }, { processedAt: null, updatedAt: window }],
        },
        select: { id: true, proposerRosterId: true, receiverRosterId: true },
        take: 1000,
      })
      .catch(() => [] as SeasonTrades['native']),
  ])
  return { facts, native }
}

/**
 * The viewer's completed trades this season — the partner ranking's rule (`summarizeTradeHistory`):
 * a trade is a GROUP of fact rows under one provider transaction id (one row per side for Sleeper,
 * one per moved asset elsewhere) and counts once per party; a native trade counts once it is
 * processed. Fact rows are the viewer's when their roster id is the claimed team's `externalId`;
 * native trades when the proposer or receiver is the viewer's own `Roster`.
 */
async function countManagerTrades(args: {
  leagueId: string
  trades: SeasonTrades
  teamExternalId: string | null
  userId: string
}): Promise<number> {
  const myRoster = await prisma.roster
    .findFirst({ where: { leagueId: args.leagueId, platformUserId: args.userId }, select: { id: true } })
    .catch(() => null)
  if (!args.teamExternalId && !myRoster) return 0
  // Fact rows are mine only through my claimed team's provider id; without one, none of them are.
  const facts = args.teamExternalId ? args.trades.facts : []
  const native = args.trades.native
  // One key for "me" in both spaces: my native Roster id when I have one, else a key no native trade can carry.
  const viewer = myRoster?.id ?? `team:${args.teamExternalId}`
  const { tradesByRoster } = summarizeTradeHistory({
    facts,
    nativeTrades: native,
    rosterIdByProviderId: args.teamExternalId
      ? buildRosterIdMap([args.teamExternalId], (id) => id, () => viewer)
      : new Map(),
    viewerRosterId: viewer,
  })
  return tradesByRoster.get(viewer) ?? 0
}

/**
 * The viewer's own draft picks this season — Draft HQ's rule: a `DraftFact` is yours when its
 * `managerId` is your claimed team's `externalId` (the sync resolves each pick to the team that
 * owned the drafting slot, so a traded pick lands on whoever made it; keepers are picks too). Each
 * sibling importer holds its own copy of the draft, so a pick counts once per slot.
 */
async function countManagerPicks(args: { factLeagueIds: string[]; season: number; teamExternalId: string | null }): Promise<number> {
  if (!args.teamExternalId) return 0
  const picks = await prisma.draftFact
    .findMany({
      where: { leagueId: { in: args.factLeagueIds }, season: args.season, managerId: args.teamExternalId },
      select: { round: true, pickNumber: true },
    })
    .catch(() => [] as Array<{ round: number; pickNumber: number }>)
  return new Set(picks.map((p) => `${p.round}:${p.pickNumber}`)).size
}

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
  const [team, transactionGroups, draftPicks, rosterMoves, standings, profile] = await Promise.all([
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
  const acquisitions = [...byType.entries()]
    .filter(([type]) => /add|waiver|free_agent|claim/.test(type))
    .reduce((sum, [, count]) => sum + count, 0)
  const commissioner = league.userId === userId || Boolean(team?.isCommissioner || team?.isCoCommissioner)

  /*
   * "My team" figures are the VIEWER's, for this season; the commissioner edition's are the
   * LEAGUE's. Trades in both come from one read of the season's completed trades, across every
   * sibling importer row. `draftPicks` above is the league's and is the commissioner edition's.
   */
  const teamExternalId = team?.externalId != null && String(team.externalId) !== '' ? String(team.externalId) : null
  const seasonFactLeagueIds = [
    ...new Set([...factLeagueIds.filter((id): id is string => Boolean(id)), ...(await siblingLeagueIds(league))]),
  ]
  const seasonTrades = await loadSeasonTrades({ leagueId, factLeagueIds: seasonFactLeagueIds, season })
  const [myTrades, myDraftPicks] = await Promise.all([
    countManagerTrades({ leagueId, trades: seasonTrades, teamExternalId, userId }),
    countManagerPicks({ factLeagueIds: seasonFactLeagueIds, season, teamExternalId }),
  ])

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
      trades: myTrades,
      draftPicks: myDraftPicks,
      bestTrade,
      outlook,
    },
    commissioner: commissioner ? {
      teams: teamCount,
      // Each completed trade once — not one per Sleeper side, not one per importer copy.
      trades: countCompletedTrades({ facts: seasonTrades.facts, nativeTrades: seasonTrades.native }),
      rosterChanges: rosterMoves + acquisitions,
      draftPicks,
      leader: standings[0] ? { teamId: standings[0].teamId, record: `${standings[0].wins}-${standings[0].losses}`, pointsFor: standings[0].pointsFor } : null,
    } : null,
  })
}
