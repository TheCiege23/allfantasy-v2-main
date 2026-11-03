import { parseZombieSettlementSnapshot } from '@/lib/zombie/weeklySettlementSnapshot'
import { beta2025ContextFromSnapshot } from '@/lib/zombie/beta2025Winnings'
/**
 * GET: Zombie league summary (statuses, whisperer, survivors, zombies, config). PROMPT 353.
 *
 * Also everything the Zombie home tab draws: the season (sport, weeks, scene), the viewer's own status,
 * matchup and winnings, and the rule numbers the engine actually uses (`getZombieRulesForSport`).
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
import { loadNativeWeekResults } from '@/lib/zombie/ZombieInfectionEngine'
import { getZombieRulesForSport } from '@/lib/zombie/zombieRules'
import { BASH_TRANSFER_SHARE, MAUL_TRANSFER_SHARE } from '@/lib/zombie/winningsShares'
import {
  buildZombieWeeklyBoard,
  pickMyMatchup,
  pickTurnMoment,
  resolveSummaryWeek,
  withBoardDetail,
  zombieRosterDisplayNames,
  zombieThemeForLeague,
} from '@/lib/zombie/zombieHomeSummary'
import { buildZombieMatchups, infectionPairsForWeek } from '@/lib/zombie/zombieMatchupBoard'

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
      select: {
        name: true,
        zombieLeague: {
          select: {
            id: true,
            universeId: true,
            sport: true,
            season: true,
            currentWeek: true,
            totalWeeks: true,
            themeLabel: true,
            status: true,
            whispererIsPublic: true,
          },
        },
      },
    }),
    prisma.roster.findMany({
      where: { leagueId },
      select: {
        id: true,
        platformUserId: true,
        playerData: true,
        redraftRoster: { select: { teamName: true, ownerName: true } },
      },
      orderBy: { id: 'asc' },
    }),
    getCurrentUserRosterIdForLeague(leagueId, userId),
    prisma.leagueTeam.findMany({
      where: { leagueId },
      select: {
        id: true,
        teamName: true,
        ownerName: true,
        externalId: true,
        platformUserId: true,
        claimedByUserId: true,
      },
      orderBy: [{ currentRank: 'asc' }, { id: 'asc' }],
    }),
  ])

  if (!config) return NextResponse.json({ error: 'Config not found' }, { status: 500 })

  const weekParam = typeof _req.url === 'string' ? new URL(_req.url).searchParams?.get('week') : null
  const zl = league?.zombieLeague ?? null
  const totalWeeks = Math.max(1, zl?.totalWeeks ?? 1)
  const currentWeek = Math.max(0, zl?.currentWeek ?? 0)
  const week = resolveSummaryWeek(weekParam, currentWeek, totalWeeks)
  const universeId = zl?.universeId ?? null
  const sport = zl?.sport ?? 'NFL'
  const season = zl?.season ?? new Date().getFullYear()

  const [board, rules, weekResults, zombieTeams] = await Promise.all([
    getWeeklyBoardData(leagueId, week, universeId),
    getZombieRulesForSport(sport),
    loadNativeWeekResults(leagueId, week, season).catch(() => null),
    prisma.zombieLeagueTeam.findMany({
      where: { leagueId },
      select: { rosterId: true, status: true, revivedAt: true, weekBecameZombie: true, killedByRosterId: true },
    }),
  ])

  // By the shared roster↔team rule; pairing the two lists by position named teams after strangers.
  const rosterDisplayNames = zombieRosterDisplayNames(rosters, teams)

  let myResources = { serums: 0, weapons: 0, ambush: 0 }
  let myWinnings: { week: number | null; total: number } | null = null
  if (myRosterId) {
    const [serums, ambush, weaponRows, winningsRows, myTeam] = await Promise.all([
      getSerumBalance(leagueId, myRosterId),
      getAmbushBalance(leagueId, myRosterId),
      prisma.zombieResourceLedger.findMany({
        where: { leagueId, rosterId: myRosterId, resourceType: 'weapon' },
        select: { balance: true },
      }),
      prisma.zombieWeeklyWinnings.findMany({
        where: { leagueId, rosterId: myRosterId },
        select: { week: true, amount: true },
      }),
      prisma.zombieLeagueTeam.findUnique({
        where: { leagueId_rosterId: { leagueId, rosterId: myRosterId } },
        select: {
          ambushesRemaining: true,
          items: { where: { isUsed: false, isExpired: false }, select: { itemType: true } },
        },
      }),
    ])
    /*
     * 🛑 A NATIVE LEAGUE'S SUPPLIES ARE TEAM ITEMS, NOT LEDGER ROWS. `weaponEngine` and `serumEngine` (the
     * weekly resolution) write `ZombieTeamItem`; `zombieResourceLedger` is the legacy store. Reading only
     * the ledger showed every native team 0 of everything. Each flow writes one store, so they add.
     */
    const unused = myTeam?.items ?? []
    const weapons =
      (sport === 'NFL' && weekResults !== null ? 0 : weaponRows.reduce((sum, row) => sum + row.balance, 0)) + unused.filter((i) => i.itemType.startsWith('weapon')).length
    myResources = {
      serums: (sport === 'NFL' && weekResults !== null ? 0 : serums) + unused.filter((i) => i.itemType.includes('serum')).length,
      weapons,
      ambush: Math.max(ambush, myTeam?.ambushesRemaining ?? 0),
    }
    const thisWeek = winningsRows.find((r) => r.week === week)
    myWinnings = {
      week: thisWeek ? thisWeek.amount : null,
      total: Math.round(winningsRows.reduce((sum, r) => sum + r.amount, 0) * 100) / 100,
    }
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
  // Statuses only ever come from the redacted list, so a hidden Whisperer reads as a Survivor here too.
  const statusOf = (rosterId: string) => shownStatuses.find((s) => s.rosterId === rosterId)?.status ?? 'Survivor'
  const mine = pickMyMatchup(weekResults, myRosterId)
  const hiddenRoster = (rosterId: string) => !viewer.canSee && identity.rosterIds.has(rosterId)
  const nameOf = (rosterId: string) => rosterDisplayNames[rosterId] ?? 'A team'
  const lossToZombieInfects = config.infectionLossToZombie !== false
  const winningsResolution = zl ? await prisma.zombieWeeklyResolution.findUnique({
    where: { zombieLeagueId_week: { zombieLeagueId: zl.id, week } },
    select: { status: true, settlementSnapshot: true },
  }) : null
  const winningsContext = beta2025ContextFromSnapshot(winningsResolution?.settlementSnapshot)
  const winningsPolicy = winningsContext || winningsResolution?.status !== 'complete' ? 'beta_2025' : 'legacy_score'
  const views = buildZombieMatchups({
    results: weekResults,
    statusOf,
    nameOf,
    infected: infectionPairsForWeek(zombieTeams, week),
    rules,
    lossToZombieInfects,
    myRosterId,
    winningsContext,
    hideWinningsOf: rosterId => !viewer.canSee && viewer.identity.rosterIds.has(rosterId),
    winningsPolicy,
    winningsRules: parseZombieSettlementSnapshot(winningsResolution?.settlementSnapshot)?.rules,
  })
  const weeklyBoard = withBoardDetail(
    buildZombieWeeklyBoard({
      week,
      results: weekResults,
      teams: zombieTeams,
      bashingMargin: rules.bashingThreshold,
      maulingMargin: rules.maulingThreshold,
      hiddenInfector: hiddenRoster,
    }),
    views,
  )

  // The overlay announces the latest RESOLVED week's change, whichever week the viewer is browsing.
  const lastResolved = zl?.id
    ? await prisma.zombieWeeklyResolution.findFirst({
        where: { zombieLeagueId: zl.id, status: 'complete' },
        orderBy: { week: 'desc' },
        select: { week: true },
      }).catch(() => null) // the overlay is optional; it must never take the home down
    : null
  const lastResolvedWeek = lastResolved?.week ?? null
  const turnResults =
    lastResolvedWeek == null ? null : lastResolvedWeek === week ? weekResults : await loadNativeWeekResults(leagueId, lastResolvedWeek, season).catch(() => null)
  const meRow = myRosterId ? zombieTeams.find((t) => t.rosterId === myRosterId) ?? null : null
  const turnMoment = pickTurnMoment({
    lastResolvedWeek,
    // My own status, as I may see it: a Whisperer viewer always can.
    me: meRow ? { ...meRow, status: statusOf(meRow.rosterId) } : null,
    results: turnResults,
    statusOf,
    nameOf,
    hiddenRoster,
  })

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
    league: {
      name: league?.name ?? null,
      sport,
      season,
      currentWeek,
      totalWeeks,
      status: zl?.status ?? null,
      backgroundTheme: zombieThemeForLeague(zl?.themeLabel, leagueId),
      teamCount: rosters.length,
      /** For the universe map on the home (null when the league is not in a universe). */
      universeId: zl?.universeId ?? null,
    },
    myStatus: myRosterId ? statusOf(myRosterId) : null,
    // A Whisperer is never revived, so this list cannot single one out.
    revivedRosterIds: zombieTeams
      .filter((t) => t.revivedAt != null && t.status === 'Survivor')
      .map((t) => t.rosterId),
    weeklyBoard,
    myMatchup: mine
      ? {
          ...mine,
          opponentName: rosterDisplayNames[mine.opponentRosterId] ?? 'Opponent',
          opponentStatus: statusOf(mine.opponentRosterId),
        }
      : null,
    myWinnings,
    /** My matchup as the Bashing card draws it (scores, lines, what moved). */
    myMatchupView: views.find((v) => v.mySide) ?? null,
    lastResolvedWeek,
    turnMoment,
    /**
     * The teams the viewer turned — their own deeds, so no secrecy question for the viewer. The Whisperer's
     * lair lists its horde from this; it is empty for anyone who has bitten nobody.
     */
    myInfections: myRosterId ? zombieTeams.filter((t) => t.killedByRosterId === myRosterId).map((t) => t.rosterId) : [],
    whispererPublic: zl?.whispererIsPublic !== false,
    rules: {
      bashingMargin: rules.bashingThreshold,
      maulingMargin: rules.maulingThreshold,
      knifeScore: rules.weaponShieldThreshold,
      bowScore: rules.weaponAmbushThreshold,
      axeMargin: rules.weaponAxeMargin,
      // What serumEngine.revive checks — not config.serumReviveCount, which no engine reads.
      reviveSerums: rules.reviveThreshold,
      winningsPolicy,
      bashShare: winningsPolicy === 'beta_2025' ? 1 : BASH_TRANSFER_SHARE,
      maulShare: winningsPolicy === 'beta_2025' ? 1 : MAUL_TRANSFER_SHARE,
    },
  })
}
