/**
 * Dead money: compute and apply on cut/release (PROMPT 339). Deterministic only.
 */

import { prisma } from '@/lib/prisma'
import type { SalaryCapConfig } from './types'
import { requireOwnedSalaryContract, ownedContractVersion, ContractMutationRefused,
  type ContractMutationResult } from './ContractMutationGuard'

/**
 * Compute dead money for cutting a player: remaining salary × (percent/100) per remaining year.
 * Returns { capYear: amount } for current and future years.
 */
export function computeDeadMoney(
  config: SalaryCapConfig,
  salary: number,
  yearsRemaining: number,
  fromCapYear: number
): Record<number, number> {
  if (!config.deadMoneyEnabled || yearsRemaining <= 0) return {}
  const pct = config.deadMoneyPercentPerYear / 100
  const perYear = Math.ceil(salary * pct)
  const result: Record<number, number> = {}
  for (let y = 0; y < yearsRemaining; y++) {
    result[fromCapYear + y] = perYear
  }
  return result
}

/**
 * Apply cut: mark contract as cut, set deadMoneyRemaining, create event.
 */
export async function applyCut(
  leagueId: string,
  contractId: string,
  capYear: number,
  actorUserId: string,
): Promise<ContractMutationResult> {
  try {
    return await prisma.$transaction(async tx => {
      const { config, contract } = await requireOwnedSalaryContract(tx, leagueId, contractId, actorUserId)
      if (!Number.isInteger(capYear) || capYear !== (config.season ?? new Date().getFullYear())) {
        throw new ContractMutationRefused('Cut year must match the current league season')
      }
      if (contract.status !== 'active' && contract.status !== 'tagged' && contract.status !== 'option_exercised') {
        throw new ContractMutationRefused('Contract not in cuttable state')
      }
      const yearsRemaining = contract.yearsTotal - contract.contractYear
      const deadMoney = computeDeadMoney(config, contract.salary, yearsRemaining, capYear)
      const changed = await tx.playerContract.updateMany({
        where: ownedContractVersion(contract),
        data: {
          status: 'cut',
          cutAt: new Date(),
          deadMoneyRemaining: deadMoney as object,
        },
      })
      if (changed.count !== 1) throw new ContractMutationRefused('Contract changed; refresh and try again', 409)
      await tx.salaryCapEventLog.create({ data: { leagueId, configId: config.configId, eventType: 'contract_cut', metadata: {
        contractId,
        rosterId: contract.rosterId,
        playerId: contract.playerId,
        capYear,
        deadMoney,
      } } })
      return { ok: true }
    }, { isolationLevel: 'Serializable', timeout: 20_000 })
  } catch (error) {
    if (error instanceof ContractMutationRefused) return { ok: false, error: error.message, status: error.status }
    throw error
  }
}
