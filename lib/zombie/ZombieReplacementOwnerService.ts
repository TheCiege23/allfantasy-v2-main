/** All replacement callers use the authenticated, timed, atomic operations path. */
import { ownerRecoveryAction } from './seasonOperations'

export async function flagInactiveRoster(leagueId: string, rosterId: string, reason: string, actorUserId: string): Promise<void> {
  await ownerRecoveryAction(leagueId, actorUserId, 'contact', { rosterId, reason })
}
export async function assignReplacementOwner(leagueId: string, rosterId: string, newUserId: string, actorUserId: string, reason: string): Promise<void> {
  await ownerRecoveryAction(leagueId, actorUserId, 'replace', { rosterId, newUserId, reason })
}
