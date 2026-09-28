/**
 * Cap calculation: current cap hit, cap space, legality (PROMPT 339). Deterministic only.
 */

import { prisma } from '@/lib/prisma'
import { getSalaryCapConfig } from './SalaryCapLeagueConfig'
import type { SalaryCapConfig } from './types'
import type { CapLegalityResult, TeamLedgerRow } from './types'

/** Get effective cap for a given year (startup cap + growth + rollover used). */
export function getEffectiveCap(config: SalaryCapConfig, capYear: number, rolloverUsed: number): number {
  const baseCap = config.startupCap
  const growth = config.capGrowthPercent / 100
  const yearsFromStart = Math.max(0, capYear - (config.capStartYear ?? new Date().getFullYear()))
  const cap = Math.floor(baseCap * Math.pow(1 + growth, yearsFromStart))
  return cap + rolloverUsed
}

/** Compute total cap hit for a roster in a cap year from active contracts + dead money. */
export async function getTotalCapHitForRoster(
  configId: string,
  rosterId: string,
  capYear: number
): Promise<{ totalCapHit: number; deadMoneyHit: number }> {
  const contracts = await prisma.playerContract.findMany({
    where: {
      configId,
      rosterId,
      status: { in: ['active', 'tagged', 'option_exercised'] },
      yearSigned: { lte: capYear },
    },
    select: { salary: true, yearsTotal: true, yearSigned: true },
  })
  let totalCapHit = 0
  for (const c of contracts) {
    const endYear = c.yearSigned + c.yearsTotal - 1
    if (capYear >= c.yearSigned && capYear <= endYear) totalCapHit += c.salary
  }
  const deadRows = await prisma.playerContract.findMany({
    where: { configId, rosterId, status: 'cut' },
    select: { deadMoneyRemaining: true },
  })
  let deadMoneyHit = 0
  for (const r of deadRows) {
    const dm = r.deadMoneyRemaining as Record<string, number> | null
    if (dm && typeof dm[String(capYear)] === 'number') deadMoneyHit += dm[String(capYear)]
  }
  return { totalCapHit, deadMoneyHit }
}

import { Prisma } from '@prisma/client'

/** Get or create ledger row for roster + cap year; recompute cap space. */
export async function getOrCreateLedger(
  config: SalaryCapConfig,
  rosterId: string,
  capYear: number
): Promise<TeamLedgerRow> {
  const { totalCapHit, deadMoneyHit } = await getTotalCapHitForRoster(config.configId, rosterId, capYear)
  const existing = await prisma.salaryCapTeamLedger.findUnique({
    where: {
      configId_rosterId_capYear: { configId: config.configId, rosterId, capYear },
    },
    select: { rolloverUsed: true },
  })
  const rolloverUsed = existing?.rolloverUsed ?? 0
  const effectiveCap = getEffectiveCap(config, capYear, rolloverUsed)
  const capSpace = effectiveCap - totalCapHit - deadMoneyHit

  await prisma.salaryCapTeamLedger.upsert({
    where: {
      configId_rosterId_capYear: { configId: config.configId, rosterId, capYear },
    },
    create: {
      leagueId: config.leagueId,
      configId: config.configId,
      rosterId,
      capYear,
      totalCapHit,
      deadMoneyHit,
      rolloverUsed,
      capSpace,
    },
    update: { totalCapHit, deadMoneyHit, capSpace },
  })

  return {
    rosterId,
    capYear,
    totalCapHit,
    deadMoneyHit,
    rolloverUsed,
    capSpace,
  }
}

/** Check cap legality for a roster in a cap year. */
export async function checkCapLegality(
  config: SalaryCapConfig,
  rosterId: string,
  capYear: number
): Promise<CapLegalityResult> {
  const ledger = await getOrCreateLedger(config, rosterId, capYear)
  const effectiveCap = getEffectiveCap(config, capYear, ledger.rolloverUsed)
  const totalHit = ledger.totalCapHit + ledger.deadMoneyHit
  const errors: string[] = []
  if (totalHit > effectiveCap) errors.push(`Over cap by ${totalHit - effectiveCap}`)
  if (config.capFloorEnabled && config.capFloorAmount != null && totalHit < config.capFloorAmount) {
    errors.push(`Under cap floor by ${config.capFloorAmount - totalHit}`)
  }
  return {
    legal: errors.length === 0,
    totalCapHit: ledger.totalCapHit,
    capSpace: ledger.capSpace,
    overBy: totalHit > effectiveCap ? totalHit - effectiveCap : undefined,
    underFloorBy:
      config.capFloorEnabled && config.capFloorAmount != null && totalHit < config.capFloorAmount
        ? config.capFloorAmount - totalHit
        : undefined,
    errors,
  }
}

/** Get current cap year (season). */
export function getCurrentCapYear(): number {
  return new Date().getFullYear()
}
