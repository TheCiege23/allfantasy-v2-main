/**
 * Extension eligibility and pricing (PROMPT 339). Deterministic only.
 */

import { prisma } from '@/lib/prisma'
import { getSalaryCapConfig } from './SalaryCapLeagueConfig'
import type { ExtensionEligibility } from './types'
import type { Prisma } from '@prisma/client'
import { requireOwnedSalaryContract, ownedContractVersion, ContractMutationRefused,
  type ContractMutationResult } from './ContractMutationGuard'

const EXTENSION_MULTIPLIER = 1.1
const EXTENSION_MAX_YEARS = 4

/** Check if a contract is extension-eligible and compute extension price. */
export async function getExtensionEligibility(
  leagueId: string,
  contractId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<ExtensionEligibility | null> {
  const config = await getSalaryCapConfig(leagueId, db)
  if (!config || !config.extensionsEnabled) return null
  const contract = await db.playerContract.findFirst({
    where: { id: contractId, leagueId, configId: config.configId },
  })
  if (!contract) return null
  if (contract.status !== 'active' && contract.status !== 'option_exercised') {
    return { eligible: false, contractId, currentSalary: contract.salary, extensionPrice: 0, maxExtensionYears: 0, reason: 'Contract not active' }
  }
  const inFinalYear = contract.contractYear >= contract.yearsTotal
  if (!inFinalYear) {
    return { eligible: false, contractId, currentSalary: contract.salary, extensionPrice: 0, maxExtensionYears: 0, reason: 'Not in final contract year' }
  }
  const extensionPrice = Math.ceil(contract.salary * EXTENSION_MULTIPLIER)
  return {
    eligible: true,
    contractId,
    currentSalary: contract.salary,
    extensionPrice,
    maxExtensionYears: Math.min(EXTENSION_MAX_YEARS, config.contractMaxYears),
    reason: undefined,
  }
}

/** Apply extension: new contract row or update; mark old as replaced. League-specific: here we create new contract. */
export async function applyExtension(
  leagueId: string,
  contractId: string,
  newYears: number,
  newSalary: number,
  actorUserId: string,
): Promise<ContractMutationResult> {
  try {
    return await prisma.$transaction(async tx => {
      const { config, contract } = await requireOwnedSalaryContract(tx, leagueId, contractId, actorUserId)
      const elig = await getExtensionEligibility(leagueId, contractId, tx)
      if (!elig?.eligible) throw new ContractMutationRefused(elig?.reason ?? 'Not eligible')
      if (!Number.isSafeInteger(newYears) || newYears < 1 || newYears > elig.maxExtensionYears) {
        throw new ContractMutationRefused(`Years must be 1-${elig.maxExtensionYears}`)
      }
      if (!Number.isSafeInteger(newSalary) || newSalary < elig.extensionPrice) {
        throw new ContractMutationRefused(`Salary must be at least ${elig.extensionPrice}`)
      }
      const capYear = config.season ?? new Date().getFullYear()
      const changed = await tx.playerContract.updateMany({
        where: ownedContractVersion(contract),
        data: { status: 'expired' },
      })
      if (changed.count !== 1) throw new ContractMutationRefused('Contract changed; refresh and try again', 409)
      await tx.playerContract.create({
        data: {
          leagueId,
          configId: config.configId,
          rosterId: contract.rosterId,
          playerId: contract.playerId,
          playerName: contract.playerName,
          position: contract.position,
          salary: newSalary,
          yearsTotal: newYears,
          yearSigned: capYear,
          contractYear: 1,
          status: 'active',
          source: 'extension',
        },
      })
      return { ok: true }
    }, { isolationLevel: 'Serializable', timeout: 20_000 })
  } catch (error) {
    if (error instanceof ContractMutationRefused) return { ok: false, error: error.message, status: error.status }
    throw error
  }
}
