/**
 * How Chimmy plays Survivor for a castaway it runs: the pure decisions. Kept free of prisma and of the
 * ballot service so the tally's auto-cast fallback can use them without an import cycle. See
 * ./chimmyCastaway.ts for the turn that applies them.
 */
export type ChimmyTarget = { userId: string; seasonPoints: number; weekPoints: number }

const MERGED_PHASES = new Set(['merge', 'post_merge', 'jury', 'finale'])

export function councilIsMerged(phase: string | null | undefined, attendingTribeId: string | null | undefined): boolean {
  return MERGED_PHASES.has(String(phase ?? '')) || (!attendingTribeId && String(phase ?? '') !== 'pre_merge')
}

/** Pure: who Chimmy votes for. Ties break by this week's score, then id, so the choice is stable. */
export function chimmyVoteTarget(targets: ReadonlyArray<ChimmyTarget>, merged: boolean): string | null {
  if (targets.length === 0) return null
  const sorted = [...targets].sort((a, b) =>
    merged
      ? b.seasonPoints - a.seasonPoints || b.weekPoints - a.weekPoints || a.userId.localeCompare(b.userId)
      : a.seasonPoints - b.seasonPoints || a.weekPoints - b.weekPoints || a.userId.localeCompare(b.userId),
  )
  return sorted[0]!.userId
}

/**
 * Pure: is Chimmy's castaway likely to be voted out? `field` is everyone who can receive votes,
 * Chimmy included. Before the merge, the two weakest are at risk; after it, the biggest threat and
 * the weakest are.
 */
export function chimmyAtRisk(selfUserId: string, field: ReadonlyArray<ChimmyTarget>, merged: boolean): boolean {
  if (!field.some((t) => t.userId === selfUserId) || field.length < 3) return false
  const weakest = [...field].sort((a, b) => a.seasonPoints - b.seasonPoints || a.userId.localeCompare(b.userId))
  if (!merged) return weakest.slice(0, 2).some((t) => t.userId === selfUserId)
  const threat = [...field].sort((a, b) => b.seasonPoints - a.seasonPoints || a.userId.localeCompare(b.userId))[0]!
  return threat.userId === selfUserId || weakest[0]!.userId === selfUserId
}

/** Powers that keep the player who plays them safe at this council. */
export const CHIMMY_PROTECTIVE_POWERS = new Set(['vote_shield', 'protect_self', 'immunity'])
