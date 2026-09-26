/**
 * Future cap projection: multi-year cap hit and space (PROMPT 339). Deterministic only.
 */

import { getSalaryCapConfig } from './SalaryCapLeagueConfig'
import {
  getEffectiveCap,
  getTotalCapHitForRoster,
} from './CapCalculationService'
import { prisma } from '@/lib/prisma'
import type { FutureCapYear } from './types'

export async function getFutureCapProjection(
  leagueId: string,
  rosterId: string,
  capYears: number[]
): Promise<FutureCapYear[]> {
  const config = await getSalaryCapConfig(leagueId)
  if (!config?.configId) return []
  const currentYear = config.season ?? new Date().getFullYear()
  const years = capYears.length ? capYears : [currentYear, currentYear + 1, currentYear + 2]
  const out: FutureCapYear[] = []
  const contracts = await prisma.playerContract.findMany({
    where: { leagueId, configId: config.configId, rosterId,
      status: { in: ['active', 'tagged', 'option_exercised'] } },
    select: { yearSigned: true, yearsTotal: true },
  })
  for (const capYear of years) {
    const { totalCapHit, deadMoneyHit } = await getTotalCapHitForRoster(
      config.configId,
      rosterId,
      capYear
    )
    const ledger = await prisma.salaryCapTeamLedger.findUnique({
      where: { configId_rosterId_capYear: { configId: config.configId, rosterId, capYear } },
      select: { rolloverUsed: true },
    })
    const effectiveCap = getEffectiveCap(config, capYear, ledger?.rolloverUsed ?? 0)
    const projectedSpace = effectiveCap - totalCapHit - deadMoneyHit
    const contractCount = contracts.filter((contract) => contract.yearSigned <= capYear
      && contract.yearSigned + contract.yearsTotal > capYear).length
    out.push({
      capYear,
      capCeiling: effectiveCap,
      totalCapHit,
      deadMoney: deadMoneyHit,
      projectedSpace,
      contractCount,
    })
  }
  return out
}
