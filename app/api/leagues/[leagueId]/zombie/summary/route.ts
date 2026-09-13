/**
 * GET: Zombie league summary (statuses, whisperer, survivors, zombies, config). PROMPT 353.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft, getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import {
  isZombieLeague,
  getZombieLeagueConfig,
} from '@/lib/zombie/ZombieLeagueConfig'
import {
  getWhispererRosterId,
  getAllStatuses,
} from '@/lib/zombie/ZombieOwnerStatusService'
import { getWeeklyBoardData } from '@/lib/zombie/ZombieWeeklyBoardService'
import { getSerumBalance } from '@/lib/zombie/ZombieSerumEngine'
import { getAmbushBalance } from '@/lib/zombie/ZombieAmbushEngine'
import { prisma } from '@/lib/prisma'
import { resolveWhispererViewer } from '@/lib/zombie/whispererViewer'
import {
  redactStatusEntries,
  redactSurvivorAndZombieIds,
  withWhispererRoster,
} from '@/lib/zombie/whispererRedaction'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const isZombie = await isZombieLeague(leagueId)
  if (!isZombie) return NextResponse.json({ error: 'Not a zombie league' }, { status: 404 })

  const [config, statuses, whispererId, league, rosters, myRosterId, teams] = await Promise.all([
    getZombieLeagueConfig(leagueId),
    getAllStatuses(leagueId),
    getWhispererRosterId(leagueId),
    prisma.league.findUnique({
      where: { id: leagueId },
      select: { zombieLeague: { select: { universeId: true } } },
    }),
    prisma.roster.findMany({ where: { leagueId }, select: { id: true } }),
    getCurrentUserRosterIdForLeague(leagueId, userId),
    prisma.leagueTeam.findMany({
      where: { leagueId },
      select: { id: true, teamName: true, ownerName: true },
      orderBy: [{ currentRank: 'asc' }, { id: 'asc' }],
    }),
  ])

  if (!config) return NextResponse.json({ error: 'Config not found' }, { status: 500 })

  const weekParam = typeof _req.url === 'string' ? new URL(_req.url).searchParams?.get('week') : null
  const week = weekParam ? Math.max(1, parseInt(weekParam, 10)) || 1 : 1
  const universeId = league?.zombieLeague?.universeId ?? null
  const board = await getWeeklyBoardData(leagueId, week, universeId)

  const rosterDisplayNames: Record<string, string> = {}
  for (let i = 0; i < rosters.length && i < teams.length; i++) {
    const r = rosters[i]
    const t = teams[i]
    if (r && t) rosterDisplayNames[r.id] = t.teamName || t.ownerName || r.id
  }
  for (const r of rosters) {
    if (!rosterDisplayNames[r.id]) rosterDisplayNames[r.id] = r.id
  }

  let myResources = { serums: 0, weapons: 0, ambush: 0 }
  if (myRosterId) {
    const [serums, ambush, weaponRows] = await Promise.all([
      getSerumBalance(leagueId, myRosterId),
      getAmbushBalance(leagueId, myRosterId),
      prisma.zombieResourceLedger.findMany({
        where: { leagueId, rosterId: myRosterId, resourceType: 'weapon' },
        select: { balance: true },
      }),
    ])
    const weapons = weaponRows.reduce((sum, row) => sum + row.balance, 0)
    myResources = { serums, weapons, ambush }
  }

  // Whisperer secrecy: the id, its status and its absence from the survivor/zombie lists would
  // each identify it, so all three go through the viewer's permission.
  const viewer = await resolveWhispererViewer(leagueId, userId)
  const identity = withWhispererRoster(viewer.identity, whispererId)
  const allStatuses = statuses.map((s) => ({ rosterId: s.rosterId, status: s.status }))
  const shownStatuses = viewer.canSee ? allStatuses : redactStatusEntries(allStatuses, identity)
  const lists = viewer.canSee
    ? { survivors: board.survivors, zombies: board.zombies }
    : redactSurvivorAndZombieIds(board, identity)

  return NextResponse.json({
    config: {
      whispererSelection: config.whispererSelection,
      infectionLossToWhisperer: config.infectionLossToWhisperer,
      infectionLossToZombie: config.infectionLossToZombie,
      serumReviveCount: config.serumReviveCount,
      zombieTradeBlocked: config.zombieTradeBlocked,
    },
    statuses: shownStatuses,
    whispererRosterId: viewer.canSee ? whispererId : null,
    whispererHidden: !viewer.canSee && whispererId != null,
    survivors: lists.survivors,
    zombies: lists.zombies,
    week,
    movementWatch: board.movementWatch,
    rosterDisplayNames,
    myRosterId: myRosterId ?? undefined,
    myResources,
  })
}
