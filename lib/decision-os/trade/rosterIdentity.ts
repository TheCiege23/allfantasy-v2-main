/**
 * Decision OS — Phase E.5: canonical roster-identity join (read-only, shadow-only).
 *
 * The canonical world's rosters come from `prisma.roster` (`world.rosters[].rosterId = Roster.id`), but a
 * redraft trade proposal addresses participants by `RedraftRoster.id` — a DIFFERENT table, a DIFFERENT id
 * space. So a proposal's `proposerRosterId`/`receiverRosterId` may not directly appear in the canonical
 * world even when the world fully describes that league (the known E.4 roster-identity mismatch).
 *
 * This module maps a proposal-space roster id to a canonical roster id WHEN POSSIBLE, using only the join
 * keys the canonical world already carries (`RosterFacts.teamId`, `TeamFacts.managerUserId`) — the SAME
 * managerUserId → teamId → roster chain the lineup bridge uses. It is PURE and READ-ONLY: it performs NO
 * owner repair, NO mutation, and invents nothing. When a participant cannot be mapped it is reported
 * `unresolved` and the caller keeps its honest skip.
 *
 * The proposal→join-key lookup itself (e.g. reading `RedraftRoster` to learn a roster's team/manager) is a
 * SEPARATE injectable read-only resolver ({@link RosterIdentityResolver}); production shadow injects none
 * (direct-match only, preserving E.4 behavior), while the DB-gated validation script injects a real one.
 */
import type { CanonicalWorld } from '@/lib/decision-os/world/facts'

/** Read-only join keys for a proposal-space roster id. No field is fabricated; absent ⇒ unknown. */
export interface ProposalRosterIdentity {
  rosterId: string
  teamId?: string | null
  managerUserId?: string | null
}

export interface RosterIdentityResolver {
  /** READ-ONLY: resolve join keys for proposal roster ids. NEVER writes. Returns [] when unavailable. */
  resolve: (leagueId: string, rosterIds: string[]) => Promise<ProposalRosterIdentity[]>
}

export type RosterIdentityMethod = 'direct' | 'team' | 'manager' | 'unresolved'

export interface RosterIdentityJoin {
  /** True ONLY when BOTH participants mapped to a canonical roster (method != 'unresolved'). */
  resolved: boolean
  /** Canonical roster id for the proposer (== input when `direct`/`unresolved`). */
  proposerRosterId: string
  /** Canonical roster id for the receiver (== input when `direct`/`unresolved`). */
  receiverRosterId: string
  proposerMethod: RosterIdentityMethod
  receiverMethod: RosterIdentityMethod
  /** proposal-space roster id → canonical roster id, for the entries that were REMAPPED (non-direct only). */
  remap: Record<string, string>
  /** Honest notes (provenance/debug only — never consumed by decision rules). */
  warnings: string[]
}

/** Resolve one proposal-space roster id to a canonical roster id via direct → team → manager, in order. */
function mapOne(
  world: CanonicalWorld,
  rosterId: string,
  identity: ProposalRosterIdentity | undefined,
): { canonicalRosterId: string; method: RosterIdentityMethod } {
  // 1. Direct: the proposal id already names a canonical roster (native AF leagues, matching id space).
  if (world.rosters.some((r) => r.rosterId === rosterId)) {
    return { canonicalRosterId: rosterId, method: 'direct' }
  }
  if (!identity) return { canonicalRosterId: rosterId, method: 'unresolved' }

  // 2. Team join: the proposal roster's teamId names a canonical roster's teamId.
  if (identity.teamId) {
    const byTeam = world.rosters.find((r) => r.teamId === identity.teamId)
    if (byTeam) return { canonicalRosterId: byTeam.rosterId, method: 'team' }
  }

  // 3. Manager join: the proposal roster's managerUserId names a canonical team; map to that team's roster.
  if (identity.managerUserId) {
    const team = world.teams.find((t) => t.managerUserId === identity.managerUserId)
    if (team) {
      const byManager = world.rosters.find((r) => r.teamId === team.teamId)
      if (byManager) return { canonicalRosterId: byManager.rosterId, method: 'manager' }
    }
  }

  return { canonicalRosterId: rosterId, method: 'unresolved' }
}

/**
 * Map both proposal participants to canonical roster ids. Pure; never throws. `identities` is the
 * pre-resolved (read-only) join-key lookup — pass `[]`/undefined for direct-match-only behavior.
 */
export function resolveRosterIdentityJoin(
  world: CanonicalWorld,
  args: { proposerRosterId: string; receiverRosterId: string },
  identities?: ProposalRosterIdentity[],
): RosterIdentityJoin {
  const byRosterId = new Map<string, ProposalRosterIdentity>()
  for (const id of identities ?? []) {
    if (id?.rosterId) byRosterId.set(id.rosterId, id)
  }

  const proposer = mapOne(world, args.proposerRosterId, byRosterId.get(args.proposerRosterId))
  const receiver = mapOne(world, args.receiverRosterId, byRosterId.get(args.receiverRosterId))

  const remap: Record<string, string> = {}
  if (proposer.method !== 'direct' && proposer.method !== 'unresolved') {
    remap[args.proposerRosterId] = proposer.canonicalRosterId
  }
  if (receiver.method !== 'direct' && receiver.method !== 'unresolved') {
    remap[args.receiverRosterId] = receiver.canonicalRosterId
  }

  const warnings: string[] = []
  if (proposer.method === 'unresolved') warnings.push('proposer_roster_identity_unresolved')
  if (receiver.method === 'unresolved') warnings.push('receiver_roster_identity_unresolved')

  return {
    resolved: proposer.method !== 'unresolved' && receiver.method !== 'unresolved',
    proposerRosterId: proposer.canonicalRosterId,
    receiverRosterId: receiver.canonicalRosterId,
    proposerMethod: proposer.method,
    receiverMethod: receiver.method,
    remap,
    warnings,
  }
}
