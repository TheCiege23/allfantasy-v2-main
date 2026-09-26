/**
 * Load and validate Salary Cap league config from DB. Sport-aware defaults (PROMPT 339).
 */

import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type { LeagueSport, Prisma } from '@prisma/client'
import {
  SALARY_CAP_VARIANT,
  DEFAULT_STARTUP_CAP,
  DEFAULT_CAP_GROWTH_PERCENT,
  DEFAULT_CONTRACT_MIN_YEARS,
  DEFAULT_CONTRACT_MAX_YEARS,
  DEFAULT_ROOKIE_CONTRACT_YEARS,
  DEFAULT_MINIMUM_SALARY,
  DEFAULT_DEAD_MONEY_PERCENT,
  DEFAULT_ROLLOVER_MAX,
  DEFAULT_AUCTION_HOLDBACK,
  DEFAULT_STARTUP_CAP_BY_SPORT,
  DEFAULT_CAP_GROWTH_BY_SPORT,
  DEFAULT_CONTRACT_MAX_YEARS_BY_SPORT,
  DEFAULT_ROOKIE_CONTRACT_YEARS_BY_SPORT,
  DEFAULT_ROLLOVER_MAX_BY_SPORT,
} from './constants'
import type { SalaryCapConfig, SalaryCapMode, StartupDraftType, FutureDraftType } from './types'

export async function isSalaryCapLeague(leagueId: string): Promise<boolean> {
  const config = await prisma.salaryCapLeagueConfig.findUnique({
    where: { leagueId },
    select: { id: true },
  })
  if (config) return true
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { leagueVariant: true },
  })
  return league?.leagueVariant === SALARY_CAP_VARIANT
}

function toMode(s: unknown): SalaryCapMode {
  if (s === 'bestball') return 'bestball'
  return 'dynasty'
}

function toStartupDraftType(s: unknown): StartupDraftType {
  if (s === 'snake') return 'snake'
  return 'auction'
}

function toFutureDraftType(s: unknown): FutureDraftType {
  if (s === 'auction' || s === 'weighted_lottery') return s
  // 'linear' is legacy — normalize to 'snake' (snake rookie-scale contracts)
  return 'snake'
}

export async function getSalaryCapConfig(
  leagueId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<SalaryCapConfig | null> {
  const league = await db.league.findUnique({
    where: { id: leagueId },
    select: { id: true, sport: true, leagueVariant: true, settings: true, season: true },
  })
  if (!league) return null
  const sport = normalizeToSupportedSport(league.sport) as LeagueSport
  const settings = (league.settings ?? {}) as Record<string, unknown>
  const declaredStartYear = typeof settings.capStartYear === 'number'
    && Number.isInteger(settings.capStartYear) && settings.capStartYear >= 1900 && settings.capStartYear <= 3000
    ? settings.capStartYear : undefined

  const row = await db.salaryCapLeagueConfig.findUnique({
    where: { leagueId },
  })
  if (row) {
    return {
      leagueId: row.leagueId,
      configId: row.id,
      sport,
      mode: toMode(row.mode),
      startupCap: row.startupCap,
      capStartYear: declaredStartYear ?? (row.createdAt instanceof Date ? row.createdAt.getUTCFullYear() : undefined),
      season: league.season,
      capGrowthPercent: row.capGrowthPercent,
      contractMinYears: row.contractMinYears,
      contractMaxYears: row.contractMaxYears,
      rookieContractYears: row.rookieContractYears,
      minimumSalary: row.minimumSalary,
      deadMoneyEnabled: row.deadMoneyEnabled,
      deadMoneyPercentPerYear: row.deadMoneyPercentPerYear,
      rolloverEnabled: row.rolloverEnabled,
      rolloverMax: row.rolloverMax,
      capFloorEnabled: row.capFloorEnabled,
      capFloorAmount: row.capFloorAmount,
      extensionsEnabled: row.extensionsEnabled,
      franchiseTagEnabled: row.franchiseTagEnabled,
      rookieOptionEnabled: row.rookieOptionEnabled,
      startupDraftType: toStartupDraftType(row.startupDraftType),
      futureDraftType: toFutureDraftType(row.futureDraftType),
      auctionHoldback: row.auctionHoldback,
      weightedLotteryEnabled: row.weightedLotteryEnabled,
      lotteryOddsConfig: row.lotteryOddsConfig ?? undefined,
      compPickEnabled: row.compPickEnabled,
      compPickFormula: row.compPickFormula ?? undefined,
      offseasonPhase: row.offseasonPhase,
      offseasonPhaseEndsAt: row.offseasonPhaseEndsAt,
    }
  }

  if (league.leagueVariant !== SALARY_CAP_VARIANT) return null

  const startupCap =
    (settings.startupCap as number) ??
    DEFAULT_STARTUP_CAP_BY_SPORT[sport] ??
    DEFAULT_STARTUP_CAP
  return {
    leagueId: league.id,
    configId: '',
    sport,
    mode: toMode(settings.mode ?? 'dynasty'),
    startupCap,
    capStartYear: declaredStartYear,
    season: league.season,
    capGrowthPercent:
      (settings.capGrowthPercent as number) ??
      DEFAULT_CAP_GROWTH_BY_SPORT[sport] ??
      DEFAULT_CAP_GROWTH_PERCENT,
    contractMinYears: (settings.contractMinYears as number) ?? DEFAULT_CONTRACT_MIN_YEARS,
    contractMaxYears:
      (settings.contractMaxYears as number) ??
      DEFAULT_CONTRACT_MAX_YEARS_BY_SPORT[sport] ??
      DEFAULT_CONTRACT_MAX_YEARS,
    rookieContractYears:
      (settings.rookieContractYears as number) ??
      DEFAULT_ROOKIE_CONTRACT_YEARS_BY_SPORT[sport] ??
      DEFAULT_ROOKIE_CONTRACT_YEARS,
    minimumSalary: (settings.minimumSalary as number) ?? DEFAULT_MINIMUM_SALARY,
    deadMoneyEnabled: (settings.deadMoneyEnabled as boolean) ?? true,
    deadMoneyPercentPerYear: (settings.deadMoneyPercentPerYear as number) ?? DEFAULT_DEAD_MONEY_PERCENT,
    rolloverEnabled: (settings.rolloverEnabled as boolean) ?? true,
    rolloverMax:
      (settings.rolloverMax as number) ??
      DEFAULT_ROLLOVER_MAX_BY_SPORT[sport] ??
      DEFAULT_ROLLOVER_MAX,
    capFloorEnabled: (settings.capFloorEnabled as boolean) ?? false,
    capFloorAmount: (settings.capFloorAmount as number) ?? null,
    extensionsEnabled: (settings.extensionsEnabled as boolean) ?? true,
    franchiseTagEnabled: (settings.franchiseTagEnabled as boolean) ?? true,
    rookieOptionEnabled: (settings.rookieOptionEnabled as boolean) ?? false,
    startupDraftType: toStartupDraftType(settings.startupDraftType ?? 'auction'),
    futureDraftType: toFutureDraftType(settings.futureDraftType ?? 'linear'),
    auctionHoldback: (settings.auctionHoldback as number) ?? DEFAULT_AUCTION_HOLDBACK,
    weightedLotteryEnabled: (settings.weightedLotteryEnabled as boolean) ?? false,
    lotteryOddsConfig: (settings.lotteryOddsConfig as object) ?? undefined,
    compPickEnabled: (settings.compPickEnabled as boolean) ?? false,
    compPickFormula: (settings.compPickFormula as object) ?? undefined,
    offseasonPhase: null,
    offseasonPhaseEndsAt: null,
  }
}

export async function upsertSalaryCapConfig(
  leagueId: string,
  input: Partial<{
    mode: string
    startupCap: number
    capGrowthPercent: number
    contractMinYears: number
    contractMaxYears: number
    rookieContractYears: number
    minimumSalary: number
    deadMoneyEnabled: boolean
    deadMoneyPercentPerYear: number
    rolloverEnabled: boolean
    rolloverMax: number
    capFloorEnabled: boolean
    capFloorAmount: number | null
    extensionsEnabled: boolean
    franchiseTagEnabled: boolean
    rookieOptionEnabled: boolean
    startupDraftType: string
    futureDraftType: string
    auctionHoldback: number
    weightedLotteryEnabled: boolean
    lotteryOddsConfig: object
    compPickEnabled: boolean
    compPickFormula: object
    offseasonPhase: string | null
    offseasonPhaseEndsAt: Date | null
  }>
): Promise<SalaryCapConfig | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { sport: true },
  })
  if (!league) return null
  const sport = normalizeToSupportedSport(league.sport) as LeagueSport

  const defaults = {
    startupCap: DEFAULT_STARTUP_CAP_BY_SPORT[sport] ?? DEFAULT_STARTUP_CAP,
    capGrowthPercent: DEFAULT_CAP_GROWTH_BY_SPORT[sport] ?? DEFAULT_CAP_GROWTH_PERCENT,
    contractMaxYears: DEFAULT_CONTRACT_MAX_YEARS_BY_SPORT[sport] ?? DEFAULT_CONTRACT_MAX_YEARS,
    rookieContractYears: DEFAULT_ROOKIE_CONTRACT_YEARS_BY_SPORT[sport] ?? DEFAULT_ROOKIE_CONTRACT_YEARS,
    rolloverMax: DEFAULT_ROLLOVER_MAX_BY_SPORT[sport] ?? DEFAULT_ROLLOVER_MAX,
  }

  await prisma.salaryCapLeagueConfig.upsert({
    where: { leagueId },
    create: {
      leagueId,
      mode: input.mode ?? 'dynasty',
      startupCap: input.startupCap ?? defaults.startupCap,
      capGrowthPercent: input.capGrowthPercent ?? defaults.capGrowthPercent,
      contractMinYears: input.contractMinYears ?? DEFAULT_CONTRACT_MIN_YEARS,
      contractMaxYears: input.contractMaxYears ?? defaults.contractMaxYears,
      rookieContractYears: input.rookieContractYears ?? defaults.rookieContractYears,
      minimumSalary: input.minimumSalary ?? DEFAULT_MINIMUM_SALARY,
      deadMoneyEnabled: input.deadMoneyEnabled ?? true,
      deadMoneyPercentPerYear: input.deadMoneyPercentPerYear ?? DEFAULT_DEAD_MONEY_PERCENT,
      rolloverEnabled: input.rolloverEnabled ?? true,
      rolloverMax: input.rolloverMax ?? defaults.rolloverMax,
      capFloorEnabled: input.capFloorEnabled ?? false,
      capFloorAmount: input.capFloorAmount ?? null,
      extensionsEnabled: input.extensionsEnabled ?? true,
      franchiseTagEnabled: input.franchiseTagEnabled ?? true,
      rookieOptionEnabled: input.rookieOptionEnabled ?? false,
      startupDraftType: input.startupDraftType ?? 'auction',
      futureDraftType: input.futureDraftType ?? 'linear',
      auctionHoldback: input.auctionHoldback ?? DEFAULT_AUCTION_HOLDBACK,
      weightedLotteryEnabled: input.weightedLotteryEnabled ?? false,
      lotteryOddsConfig: (input.lotteryOddsConfig ?? undefined) as object | undefined,
      compPickEnabled: input.compPickEnabled ?? false,
      compPickFormula: (input.compPickFormula ?? undefined) as object | undefined,
      offseasonPhase: input.offseasonPhase ?? null,
      offseasonPhaseEndsAt: input.offseasonPhaseEndsAt ?? null,
    },
    update: {
      ...(input.mode != null && { mode: input.mode }),
      ...(input.startupCap != null && { startupCap: input.startupCap }),
      ...(input.capGrowthPercent != null && { capGrowthPercent: input.capGrowthPercent }),
      ...(input.contractMinYears != null && { contractMinYears: input.contractMinYears }),
      ...(input.contractMaxYears != null && { contractMaxYears: input.contractMaxYears }),
      ...(input.rookieContractYears != null && { rookieContractYears: input.rookieContractYears }),
      ...(input.minimumSalary != null && { minimumSalary: input.minimumSalary }),
      ...(input.deadMoneyEnabled != null && { deadMoneyEnabled: input.deadMoneyEnabled }),
      ...(input.deadMoneyPercentPerYear != null && { deadMoneyPercentPerYear: input.deadMoneyPercentPerYear }),
      ...(input.rolloverEnabled != null && { rolloverEnabled: input.rolloverEnabled }),
      ...(input.rolloverMax != null && { rolloverMax: input.rolloverMax }),
      ...(input.capFloorEnabled != null && { capFloorEnabled: input.capFloorEnabled }),
      ...(input.capFloorAmount !== undefined && { capFloorAmount: input.capFloorAmount }),
      ...(input.extensionsEnabled != null && { extensionsEnabled: input.extensionsEnabled }),
      ...(input.franchiseTagEnabled != null && { franchiseTagEnabled: input.franchiseTagEnabled }),
      ...(input.rookieOptionEnabled != null && { rookieOptionEnabled: input.rookieOptionEnabled }),
      ...(input.startupDraftType != null && { startupDraftType: input.startupDraftType }),
      ...(input.futureDraftType != null && { futureDraftType: input.futureDraftType }),
      ...(input.auctionHoldback != null && { auctionHoldback: input.auctionHoldback }),
      ...(input.weightedLotteryEnabled != null && { weightedLotteryEnabled: input.weightedLotteryEnabled }),
      ...(input.lotteryOddsConfig !== undefined && { lotteryOddsConfig: input.lotteryOddsConfig as object }),
      ...(input.compPickEnabled != null && { compPickEnabled: input.compPickEnabled }),
      ...(input.compPickFormula !== undefined && { compPickFormula: input.compPickFormula as object }),
      ...(input.offseasonPhase !== undefined && { offseasonPhase: input.offseasonPhase }),
      ...(input.offseasonPhaseEndsAt !== undefined && { offseasonPhaseEndsAt: input.offseasonPhaseEndsAt }),
    },
  })
  return getSalaryCapConfig(leagueId)
}
