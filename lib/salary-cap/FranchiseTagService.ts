/**
 * Franchise tag eligibility and application (PROMPT 339). Deterministic only.
 */

import { prisma } from '@/lib/prisma'
import { getSalaryCapConfig } from './SalaryCapLeagueConfig'
import type { FranchiseTagEligibility } from './types'
import type { Prisma } from '@prisma/client'
import { requireOwnedSalaryContract, ownedContractVersion, ContractMutationRefused,
  type ContractMutationResult } from './ContractMutationGuard'

/** Tag cost = top-5 position average or % of cap; simplified: 120% of current salary. */
const TAG_PREMIUM_MULTIPLIER = 1.2

export async function getFranchiseTagEligibility(
  leagueId: string,
  rosterId: string,
  contractId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<FranchiseTagEligibility | null> {
  const config = await getSalaryCapConfig(leagueId, db)
  if (!config || !config.franchiseTagEnabled) return null
  const alreadyUsed = await db.playerContract.count({
    where: { configId: config.configId, rosterId, status: 'tagged' },
  })
  if (alreadyUsed > 0) {
    return { eligible: false, tagCost: 0, alreadyUsed: true, reason: 'Franchise tag already used' }
  }
  const contract = await db.playerContract.findFirst({
    where: { id: contractId, leagueId, configId: config.configId, rosterId },
  })
  if (!contract) return null
  const inFinalYear = contract.contractYear >= contract.yearsTotal
  if (!inFinalYear) {
    return { eligible: false, tagCost: 0, alreadyUsed: false, reason: 'Contract not in final year' }
  }
  const tagCost = Math.ceil(contract.salary * TAG_PREMIUM_MULTIPLIER)
  return { eligible: true, tagCost, alreadyUsed: false, reason: undefined }
}

export async function applyFranchiseTag(
  leagueId: string,
  contractId: string,
  actorUserId: string,
): Promise<ContractMutationResult> {
  try {
    return await prisma.$transaction(async tx => {
      const { contract } = await requireOwnedSalaryContract(tx, leagueId, contractId, actorUserId)
      const elig = await getFranchiseTagEligibility(leagueId, contract.rosterId, contractId, tx)
      if (!elig?.eligible) throw new ContractMutationRefused(elig?.reason ?? 'Not eligible')
      const changed = await tx.playerContract.updateMany({
        where: ownedContractVersion(contract),
        data: {
          status: 'tagged',
          franchiseTagAt: new Date(),
          salary: elig.tagCost,
          yearsTotal: 1,
          contractYear: 1,
        },
      })
      if (changed.count !== 1) throw new ContractMutationRefused('Contract changed; refresh and try again', 409)
      return { ok: true }
    }, { isolationLevel: 'Serializable', timeout: 20_000 })
  } catch (error) {
    if (error instanceof ContractMutationRefused) return { ok: false, error: error.message, status: error.status }
    throw error
  }
}
