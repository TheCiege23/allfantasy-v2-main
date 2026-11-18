/**
 * No trading between your own teams (owner's rule, 2026-11-18).
 *
 * A league can let one manager run several teams (lib/league/multiTeamManagers.ts). A trade between two
 * of them is one person moving players wherever it suits them, so it is refused when the offer is made.
 *
 * Two teams are the same manager's when they carry the same owner id, or when their owner ids belong to
 * accounts linked to one person (lib/identity/linkedAccounts.ts): today a manager's second team sits
 * under a second account, and that link is the only evidence the two are one person. An account with
 * no linked identity cannot be matched this way; that is a limit of the evidence, as it is at join.
 *
 * Pure rule + the linked-id read.
 */
import { rosterManagerKey } from '@/lib/league/rosterManager'
import { resolveRosterOwnerIds } from '@/lib/identity/linkedAccounts'

export const OWN_TEAM_TRADE_MESSAGE = 'You cannot trade between your own teams.'

/** True when two or more of the trade's teams belong to the same manager. */
export function isOwnTeamTrade(
  participants: ReadonlyArray<{ id: string; platformUserId: string | null; managerUserId?: string | null }>,
  actorOwnerIds: ReadonlySet<string>,
): boolean {
  // A manager's further teams carry a key of their own and name the manager (lib/league/rosterManager.ts).
  const owners = participants.map((p) => rosterManagerKey(p) ?? '').filter(Boolean)
  if (new Set(owners).size < owners.length) return true
  return owners.filter((owner) => actorOwnerIds.has(owner)).length >= 2
}

export async function assertNotOwnTeamTrade(
  actorUserId: string,
  participants: ReadonlyArray<{ id: string; platformUserId: string | null; managerUserId?: string | null }>,
): Promise<void> {
  const linked = await resolveRosterOwnerIds(actorUserId).catch(() => [] as string[])
  if (isOwnTeamTrade(participants, new Set([actorUserId, ...linked]))) throw new Error(OWN_TEAM_TRADE_MESSAGE)
}
