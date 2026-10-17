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
