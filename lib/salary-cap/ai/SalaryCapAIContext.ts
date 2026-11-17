/**
 * Build deterministic context for Salary Cap AI prompts.
 * NO AI HERE — only data from salary-cap engine. PROMPT 341.
 */

import type { LeagueSport } from '@prisma/client'
import { getSalaryCapConfig } from '../SalaryCapLeagueConfig'
import { getOrCreateLedger } from '../CapCalculationService'
import { getFutureCapProjection } from '../FutureCapProjectionService'
import { getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import { prisma } from '@/lib/prisma'

export type SalaryCapAIContextType =
  | 'startup_auction'
  | 'cap_health'
  | 'extension_tag'
  | 'trade_cap'
  | 'bestball'
  | 'offseason_planning'
  | 'orphan_takeover'

export interface SalaryCapAIDeterministicContext {
  leagueId: string
  sport: LeagueSport
  mode: string
  /** Current cap year */
  capYear: number
  /** User's roster id (if any) */
  userRosterId: string | null
  /** Config summary */
  config: {
    startupCap: number
    capGrowthPercent: number
    contractMinYears: number
    contractMaxYears: number
    rookieContractYears: number
    minimumSalary: number
    deadMoneyEnabled: boolean
    rolloverEnabled: boolean
    rolloverMax: number
    extensionsEnabled: boolean
    franchiseTagEnabled: boolean
    startupDraftType: string
    futureDraftType: string
    auctionHoldback: number
    weightedLotteryEnabled: boolean
  }
  /** Ledger for user's roster (current year) */
  ledger: {
    totalCapHit: number
    deadMoneyHit: number
    rolloverUsed: number
    capSpace: number
  } | null
  /** Future cap projection (next 3–5 years) */
  futureProjection: Array<{
    capYear: number
    capCeiling: number
    totalCapHit: number
    deadMoney: number
    projectedSpace: number
    contractCount: number
  }>
  /** Active contracts for user's roster */
  contracts: Array<{
    playerName: string | null
    position: string | null
    salary: number
    yearsTotal: number
    contractYear: number
    yearsRemaining: number
    status: string
    source: string
  }>
  /** Counts */
  expiringCount: number
  extensionCandidatesCount: number
  tagCandidatesCount: number
  deadMoneyTotal: number
  rookieContractCount: number
  /** Recent events (last 10) */
  recentEvents: Array<{ eventType: string; createdAt: Date }>
  /** Lottery result if enabled */
  lottery: { seed: string | null; order: unknown } | null
}

/**
 * Load deterministic context for salary cap AI. Used by AI route to ground prompts.
 */
export async function buildSalaryCapAIContext(args: {
  leagueId: string
  userId: string
  type: SalaryCapAIContextType
}): Promise<SalaryCapAIDeterministicContext | null> {
  const { leagueId, userId } = args
  const config = await getSalaryCapConfig(leagueId)
  if (!config) return null

  const userRosterId = await getCurrentUserRosterIdForLeague(leagueId, userId)
  const capYear = new Date().getFullYear()

  const ledger = userRosterId
    ? await getOrCreateLedger(config, userRosterId, capYear)
    : null

  const futureProjection = userRosterId
    ? await getFutureCapProjection(leagueId, userRosterId, [
        capYear,
        capYear + 1,
        capYear + 2,
        capYear + 3,
        capYear + 4,
      ])
    : []

  const contracts = userRosterId
    ? await prisma.playerContract.findMany({
        where: {
          configId: config.configId,
          rosterId: userRosterId,
          status: { in: ['active', 'tagged', 'option_exercised'] },
        },
        orderBy: { salary: 'desc' },
        select: {
          playerName: true,
          position: true,
          salary: true,
          yearsTotal: true,
          contractYear: true,
          status: true,
          source: true,
        },
      })
    : []

  const activeContracts = contracts
  const yearsRemaining = (c: { yearsTotal: number; contractYear: number }) =>
    Math.max(0, c.yearsTotal - c.contractYear)
  const expiringCount = activeContracts.filter((c) => c.contractYear >= c.yearsTotal).length
  let extensionCandidatesCount = 0
  let tagCandidatesCount = 0
  if (config.extensionsEnabled) {
    extensionCandidatesCount = activeContracts.filter((c) => c.contractYear >= c.yearsTotal).length
  }
  if (config.franchiseTagEnabled && userRosterId) {
    const tagged = await prisma.playerContract.count({
      where: { configId: config.configId, rosterId: userRosterId, status: 'tagged' },
    })
    tagCandidatesCount = tagged > 0 ? 0 : activeContracts.filter((c) => c.contractYear >= c.yearsTotal).length
  }

  const cutContracts = userRosterId
    ? await prisma.playerContract.findMany({
        where: { configId: config.configId, rosterId: userRosterId, status: 'cut' },
        select: { deadMoneyRemaining: true },
      })
    : []
  let deadMoneyTotal = 0
  for (const c of cutContracts) {
    const dm = c.deadMoneyRemaining as Record<string, number> | null
    if (dm && typeof dm[String(capYear)] === 'number') deadMoneyTotal += dm[String(capYear)]
  }

  const recentEvents = await prisma.salaryCapEventLog.findMany({
    where: { leagueId },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { eventType: true, createdAt: true },
  })

  let lottery: { seed: string | null; order: unknown } | null = null
  if (config.weightedLotteryEnabled) {
    const row = await prisma.salaryCapLotteryResult.findUnique({
      where: { configId_capYear: { configId: config.configId, capYear } },
      select: { seed: true, order: true },
    })
    if (row) lottery = { seed: row.seed, order: row.order }
  }

  return {
    leagueId,
    sport: config.sport,
    mode: config.mode,
    capYear,
    userRosterId,
    config: {
      startupCap: config.startupCap,
      capGrowthPercent: config.capGrowthPercent,
      contractMinYears: config.contractMinYears,
      contractMaxYears: config.contractMaxYears,
      rookieContractYears: config.rookieContractYears,
      minimumSalary: config.minimumSalary,
      deadMoneyEnabled: config.deadMoneyEnabled,
      rolloverEnabled: config.rolloverEnabled,
      rolloverMax: config.rolloverMax,
      extensionsEnabled: config.extensionsEnabled,
      franchiseTagEnabled: config.franchiseTagEnabled,
      startupDraftType: config.startupDraftType,
      futureDraftType: config.futureDraftType,
      auctionHoldback: config.auctionHoldback,
      weightedLotteryEnabled: config.weightedLotteryEnabled,
    },
    ledger: ledger
      ? {
          totalCapHit: ledger.totalCapHit,
          deadMoneyHit: ledger.deadMoneyHit,
          rolloverUsed: ledger.rolloverUsed,
          capSpace: ledger.capSpace,
        }
      : null,
    futureProjection,
    contracts: activeContracts.map((c) => ({
      playerName: c.playerName,
      position: c.position,
      salary: c.salary,
      yearsTotal: c.yearsTotal,
      contractYear: c.contractYear,
      yearsRemaining: yearsRemaining(c),
      status: c.status,
      source: c.source,
    })),
    expiringCount,
    extensionCandidatesCount,
    tagCandidatesCount,
    deadMoneyTotal,
    rookieContractCount: activeContracts.filter((c) => c.source === 'rookie_draft').length,
    recentEvents: recentEvents.map((e) => ({ eventType: e.eventType, createdAt: e.createdAt })),
    lottery,
  }
}
