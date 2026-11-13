/**
 * Offseason calendar: phase transitions and enforcement (PROMPT 339). Deterministic only.
 */

import { prisma } from '@/lib/prisma'
import { getSalaryCapConfig } from './SalaryCapLeagueConfig'
import { processExpirations, decrementContractYears } from './ContractLifecycleService'

type OffseasonPhase =
  | 'lock'
  | 'expiration'
  | 'rollover'
  | 'extension'
  | 'tag'
  | 'draft'
  | 'fa_open'
  | 'in_season'

export async function getCurrentPhase(leagueId: string): Promise<OffseasonPhase | null> {
  const config = await getSalaryCapConfig(leagueId)
  if (!config) return null
  if (config.offseasonPhase && config.offseasonPhaseEndsAt && new Date() < config.offseasonPhaseEndsAt) {
    return config.offseasonPhase as OffseasonPhase
  }
  return 'in_season'
}

async function setPhase(
  leagueId: string,
  phase: OffseasonPhase,
  endsAt?: Date | null
): Promise<void> {
  const config = await getSalaryCapConfig(leagueId)
  if (!config) return
  await prisma.salaryCapLeagueConfig.update({
    where: { leagueId },
    data: { offseasonPhase: phase, offseasonPhaseEndsAt: endsAt ?? null },
  })
}

/**
 * Transition: run expiration for cap year, then advance phase.
 */
export async function runExpirationPhase(leagueId: string, capYear: number): Promise<{ processed: number }> {
  const result = await processExpirations(leagueId, capYear)
  await setPhase(leagueId, 'expiration')
  return result
}

/**
 * Apply rollover to next season: add unused cap space (up to rollover max) to each roster's next year.
 */
export async function runRolloverPhase(leagueId: string, fromCapYear: number): Promise<void> {
  const config = await getSalaryCapConfig(leagueId)
  if (!config || !config.rolloverEnabled) return
  const toCapYear = fromCapYear + 1
  const ledgers = await prisma.salaryCapTeamLedger.findMany({
    where: { configId: config.configId, capYear: fromCapYear },
  })
  for (const led of ledgers) {
    const rolloverAmount = Math.min(Math.max(0, led.capSpace), config.rolloverMax)
    if (rolloverAmount <= 0) continue
    const existing = await prisma.salaryCapTeamLedger.findUnique({
      where: {
        configId_rosterId_capYear: { configId: config.configId, rosterId: led.rosterId, capYear: toCapYear },
      },
    })
    if (existing) {
      await prisma.salaryCapTeamLedger.update({
        where: {
          configId_rosterId_capYear: { configId: config.configId, rosterId: led.rosterId, capYear: toCapYear },
        },
        data: { rolloverUsed: { increment: rolloverAmount }, capSpace: { increment: rolloverAmount } },
      })
    } else {
      await prisma.salaryCapTeamLedger.create({
        data: {
          leagueId: config.leagueId,
          configId: config.configId,
          rosterId: led.rosterId,
          capYear: toCapYear,
          totalCapHit: 0,
          deadMoneyHit: 0,
          rolloverUsed: rolloverAmount,
          capSpace: rolloverAmount,
        },
      })
    }
  }
  await setPhase(leagueId, 'rollover')
}

/**
 * Advance to new season: decrement contract years, set phase in_season.
 */
export async function advanceToNewSeason(leagueId: string, newCapYear: number): Promise<{ updated: number }> {
  const result = await decrementContractYears(leagueId, newCapYear)
  await setPhase(leagueId, 'in_season')
  return result
}
