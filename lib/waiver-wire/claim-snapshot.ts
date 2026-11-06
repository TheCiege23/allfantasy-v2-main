import { Prisma } from '@prisma/client'

/** Finalize only the pending claim whose override snapshot was evaluated. */
export function claimSnapshotWhere(claim: { id: string; leagueId: string; metadata?: unknown }) {
  return { id: claim.id, leagueId: claim.leagueId, status: 'pending', metadata: { equals: claim.metadata ?? Prisma.AnyNull } }
}

export function isClaimSnapshotConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'P2025') return false
  return 'meta' in error && typeof error.meta === 'object' && error.meta !== null &&
    'modelName' in error.meta && error.meta.modelName === 'WaiverClaim'
}

/**
 * The roster write's compare-and-set: the roster as the waiver run read it. `playerData` and
 * `faabRemaining` are the two fields the award overwrites, so they are the two that must not have moved.
 */
export function rosterSnapshotWhere(
  rosterId: string,
  roster: { playerData?: unknown; faabRemaining?: number | null },
) {
  return {
    id: rosterId,
    playerData: { equals: roster.playerData ?? Prisma.AnyNull },
    faabRemaining: roster.faabRemaining ?? null,
  }
}

export function isRosterSnapshotConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'P2025') return false
  return 'meta' in error && typeof error.meta === 'object' && error.meta !== null &&
    'modelName' in error.meta && error.meta.modelName === 'Roster'
}
