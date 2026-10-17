/** Claimed players stay with their new owner when an old chop is reversed. */
export function partitionReleasedPlayers(released: string[], ownedElsewhere: ReadonlySet<string>) {
  const restore: string[] = []
  const retainedByClaimants: string[] = []
  for (const playerId of [...new Set(released)]) {
    if (ownedElsewhere.has(playerId)) retainedByClaimants.push(playerId)
    else restore.push(playerId)
  }
  return { restore, retainedByClaimants }
}

/** Historical final-score rows must not block a later ceremony for the active field. */
export function selectActiveFinalScores<T extends { rosterId: string }>(scores: T[], activeRosterIds: string[]): T[] {
  const active = new Set(activeRosterIds)
  const selected = scores.filter(score => active.has(score.rosterId))
  if (selected.length !== active.size || new Set(selected.map(score => score.rosterId)).size !== active.size) {
    throw new Error('Every active roster needs one finalized score.')
  }
  return selected
}

export function isAutomaticCeremonyDue(args: { mode: 'automatic' | 'hosted';
  ceremonyAt: string | null; statePeriod: number | null; currentPeriod: number; now: Date }): boolean {
  if (args.mode !== 'automatic' || !args.ceremonyAt || args.statePeriod !== args.currentPeriod) return false
  const dueAt = Date.parse(args.ceremonyAt)
  return Number.isFinite(dueAt) && dueAt <= args.now.getTime()
}
