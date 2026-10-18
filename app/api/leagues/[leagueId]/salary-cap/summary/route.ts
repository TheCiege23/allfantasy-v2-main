/**
 * GET: Salary Cap league summary for home/dashboard (config, ledger, contracts, projection, events).
 * Returns 404 when league is not a salary cap league. PROMPT 340.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft, getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import { isSalaryCapLeague, getSalaryCapConfig } from '@/lib/salary-cap/SalaryCapLeagueConfig'
import { getOrCreateLedger } from '@/lib/salary-cap/CapCalculationService'
import { getFutureCapProjection } from '@/lib/salary-cap/FutureCapProjectionService'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const isCap = await isSalaryCapLeague(leagueId)
  if (!isCap) return NextResponse.json({ error: 'Not a salary cap league' }, { status: 404 })

  const config = await getSalaryCapConfig(leagueId)
  if (!config) return NextResponse.json({ error: 'Config not found' }, { status: 500 })

  const myRosterId = await getCurrentUserRosterIdForLeague(leagueId, userId)
  const capYear = new Date().getFullYear()

  const [ledger, futureProjection, contracts, events, lotteryRow, leagueRow] = await Promise.all([
    myRosterId ? getOrCreateLedger(config, myRosterId, capYear) : null,
    // Four years: the specialty home's future-years columns (handoff salary/SalaryCapHome).
    myRosterId ? getFutureCapProjection(leagueId, myRosterId, [capYear, capYear + 1, capYear + 2, capYear + 3]) : [],
    myRosterId
      ? prisma.playerContract.findMany({
          where: { configId: config.configId, rosterId: myRosterId },
          orderBy: { salary: 'desc' },
          select: {
            id: true,
            playerId: true,
            playerName: true,
            position: true,
            salary: true,
            yearsTotal: true,
            yearSigned: true,
            contractYear: true,
            status: true,
            source: true,
            deadMoneyRemaining: true,
          },
        })
      : [],
    prisma.salaryCapEventLog.findMany({
      where: { leagueId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { eventType: true, metadata: true, createdAt: true },
    }),
    config.weightedLotteryEnabled
      ? prisma.salaryCapLotteryResult.findUnique({
          where: { configId_capYear: { configId: config.configId, capYear } },
          select: { seed: true, order: true },
        })
      : null,
    prisma.league.findUnique({ where: { id: leagueId }, select: { name: true, sport: true, season: true, leagueSize: true } }),
  ])

  const activeContracts = contracts.filter(
    (c) => c.status === 'active' || c.status === 'tagged' || c.status === 'option_exercised'
  )
  const expiringCount = activeContracts.filter(
    (c) => c.contractYear >= c.yearsTotal
  ).length
  let extensionCandidatesCount = 0
  let tagCandidatesCount = 0
  if (config.extensionsEnabled) {
    extensionCandidatesCount = activeContracts.filter((c) => c.contractYear >= c.yearsTotal).length
  }
  if (config.franchiseTagEnabled) {
    const tagged = contracts.filter((c) => c.status === 'tagged').length
    tagCandidatesCount = activeContracts.filter((c) => c.contractYear >= c.yearsTotal).length
    if (tagged > 0) tagCandidatesCount = 0
  }
  const deadMoneyTotal = contracts
    .filter((c) => c.status === 'cut' && c.deadMoneyRemaining)
    .reduce((sum, c) => {
      const dm = c.deadMoneyRemaining as Record<string, number> | null
      if (dm && typeof dm[String(capYear)] === 'number') return sum + dm[String(capYear)]
      return sum
    }, 0)

  return NextResponse.json({
    config: {
      mode: config.mode,
      startupCap: config.startupCap,
      capGrowthPercent: config.capGrowthPercent,
      contractMinYears: config.contractMinYears,
      contractMaxYears: config.contractMaxYears,
      rookieContractYears: config.rookieContractYears,
      minimumSalary: config.minimumSalary,
      deadMoneyEnabled: config.deadMoneyEnabled,
      deadMoneyPercentPerYear: config.deadMoneyPercentPerYear,
      rolloverEnabled: config.rolloverEnabled,
      rolloverMax: config.rolloverMax,
      capFloorEnabled: config.capFloorEnabled,
      capFloorAmount: config.capFloorAmount,
      extensionsEnabled: config.extensionsEnabled,
      franchiseTagEnabled: config.franchiseTagEnabled,
      startupDraftType: config.startupDraftType,
      futureDraftType: config.futureDraftType,
      auctionHoldback: config.auctionHoldback,
      weightedLotteryEnabled: config.weightedLotteryEnabled,
      offseasonPhase: config.offseasonPhase,
    },
    myRosterId: myRosterId ?? undefined,
    ledger: ledger
      ? {
          rosterId: ledger.rosterId,
          capYear: ledger.capYear,
          totalCapHit: ledger.totalCapHit,
          deadMoneyHit: ledger.deadMoneyHit,
          rolloverUsed: ledger.rolloverUsed,
          capSpace: ledger.capSpace,
        }
      : null,
    futureProjection,
    contracts: activeContracts.map((c) => ({
      id: c.id,
      playerId: c.playerId,
      playerName: c.playerName,
      position: c.position,
      salary: c.salary,
      yearsTotal: c.yearsTotal,
      contractYear: c.contractYear,
      yearsRemaining: c.yearsTotal - c.contractYear,
      status: c.status,
      source: c.source,
    })),
    expiringCount,
    extensionCandidatesCount,
    tagCandidatesCount,
    deadMoneyTotal,
    rookieContractCount: activeContracts.filter((c) => c.source === 'rookie_draft').length,
    events: events.map((e) => ({
      eventType: e.eventType,
      metadata: e.metadata,
      createdAt: e.createdAt,
    })),
    league: leagueRow
      ? { name: leagueRow.name, sport: String(leagueRow.sport), season: leagueRow.season, teamCount: leagueRow.leagueSize, capYear }
      : null,
    deadContracts: contracts
      .filter((c) => c.status === 'cut' && c.deadMoneyRemaining)
      .map((c) => {
        const dm = c.deadMoneyRemaining as Record<string, number> | null
        return { id: c.id, playerName: c.playerName, position: c.position, deadThisYear: dm && typeof dm[String(capYear)] === 'number' ? dm[String(capYear)] : 0 }
      })
      .filter((c) => c.deadThisYear > 0),
    lottery: lotteryRow
      ? { seed: lotteryRow.seed, order: lotteryRow.order }
      : null,
  })
}
