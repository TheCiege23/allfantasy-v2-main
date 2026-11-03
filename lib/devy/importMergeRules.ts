/**
 * Which imported player rows a Devy merge actually writes. Pure, with no prisma import, so the
 * merge engine and the import wizard's pre-merge preview share one rule instead of two copies
 * that can drift apart.
 */
export function mergeablePlayer(confirmed: boolean, matchConfidence: string, requiresReview: boolean): boolean {
  if (confirmed) return true
  if (matchConfidence === 'exact' && !requiresReview) return true
  return false
}

/** A manager row blocks the whole merge while it needs review and points at nobody. */
export function managerBlocksMerge(requiresReview: boolean, internalUserId: string | null | undefined): boolean {
  return requiresReview && !internalUserId
}
