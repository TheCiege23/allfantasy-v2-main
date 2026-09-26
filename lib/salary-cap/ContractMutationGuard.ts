import type { Prisma } from '@prisma/client'
import { isCommissioner } from '@/lib/commissioner/permissions'
import { getSalaryCapConfig } from './SalaryCapLeagueConfig'

export class ContractMutationRefused extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 = 400) {
    super(message); this.name = 'ContractMutationRefused'
  }
}
export type ContractMutationResult = { ok: boolean; error?: string; status?: number }

/** Membership permits viewing a league; modifying a contract requires its owner or head commissioner. */
export async function requireOwnedSalaryContract(
  tx: Prisma.TransactionClient, leagueId: string, contractId: string, actorUserId: string,
) {
  if (!actorUserId) throw new ContractMutationRefused('Forbidden', 403)
  const config = await getSalaryCapConfig(leagueId, tx)
  if (!config?.configId) throw new ContractMutationRefused('Salary cap rules are not available', 404)
  const contract = await tx.playerContract.findFirst({ where: { id: contractId, leagueId, configId: config.configId } })
  if (!contract) throw new ContractMutationRefused('Contract not found', 404)
  if (await isCommissioner(leagueId, actorUserId, tx)) return { config, contract }
  const [roster, claimedTeams] = await Promise.all([
    tx.roster.findFirst({ where: { id: contract.rosterId, leagueId },
      select: { id: true, leagueId: true, platformUserId: true, playerData: true } }),
    tx.leagueTeam.findMany({ where: { leagueId, claimedByUserId: actorUserId, role: { not: 'viewer' } },
      select: { id: true, leagueId: true, externalId: true, platformUserId: true, claimedByUserId: true, role: true } }),
  ])
  const currentRoster = roster?.id === contract.rosterId && roster.leagueId === leagueId ? roster : null
  const sourceManagerId = currentRoster?.playerData && typeof currentRoster.playerData === 'object'
    && !Array.isArray(currentRoster.playerData)
    ? (currentRoster.playerData as Record<string, unknown>).source_manager_id : undefined
  const owned = currentRoster?.platformUserId === actorUserId || claimedTeams.some(team =>
    team.leagueId === leagueId && team.claimedByUserId === actorUserId && team.role !== 'viewer'
    && (team.id === contract.rosterId || team.externalId === contract.rosterId
      || (typeof sourceManagerId === 'string' && sourceManagerId === team.platformUserId)))
  if (!owned) throw new ContractMutationRefused('Only the contract owner or commissioner may change this contract', 403)
  return { config, contract }
}

/** Guard the write itself so a contract moved or changed since authorization cannot be overwritten. */
export function ownedContractVersion(contract: Prisma.PlayerContractGetPayload<{}>) {
  return { id: contract.id, leagueId: contract.leagueId, configId: contract.configId,
    rosterId: contract.rosterId, updatedAt: contract.updatedAt, status: contract.status }
}
