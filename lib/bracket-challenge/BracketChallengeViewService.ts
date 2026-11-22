/**
 * BracketChallengeViewService — view state and display derivation for bracket UX.
 * Lock state, can-edit, total picks, progress, empty/loading/error.
 */

type BracketViewState = 'editing' | 'locked' | 'submitted' | 'scored' | 'loading' | 'error'

type BracketProgressDisplay = {
  totalGames: number
  pickedCount: number
  percentComplete: number
  canSubmit: boolean
  missingCount: number
}

/**
 * Derive view state from entry/league/tournament.
 */
export function getBracketViewState(
  entryStatus: string | null | undefined,
  tournamentLockAt: Date | string | null | undefined,
  entryLockedAt: Date | string | null | undefined,
  loading: boolean,
  error: string | null
): BracketViewState {
  if (loading) return 'loading'
  if (error) return 'error'
  const status = (entryStatus ?? '').toUpperCase()
  if (status === 'SCORED' || status === 'INVALIDATED') return 'scored'
  if (status === 'LOCKED' || entryLockedAt) return 'locked'
  if (status === 'SUBMITTED') return 'submitted'
  const now = new Date()
  if (tournamentLockAt && new Date(tournamentLockAt) <= now) return 'locked'
  return 'editing'
}

/**
 * Build progress display (picks filled / total games).
 */
export function getBracketProgressDisplay(
  picks: Record<string, string | null>,
  totalGames: number
): BracketProgressDisplay {
  const pickedCount = Object.values(picks).filter(Boolean).length
  const percentComplete = totalGames > 0 ? Math.round((pickedCount / totalGames) * 100) : 0
  const missingCount = Math.max(0, totalGames - pickedCount)
  const canSubmit = totalGames > 0 && pickedCount >= totalGames
  return {
    totalGames,
    pickedCount,
    percentComplete,
    canSubmit,
    missingCount,
  }
}

export function getBracketLockStateMessage(state: BracketViewState): string {
  if (state === 'locked' || state === 'scored') {
    return 'Bracket is locked. You can still track standings and leaderboard movement.'
  }
  if (state === 'submitted') {
    return 'Bracket submitted. You can edit until lock if your league rules allow it.'
  }
  if (state === 'editing') {
    return 'Bracket is editable. Picks auto-save on selection.'
  }
  if (state === 'loading') return 'Loading bracket...'
  return 'There was a problem loading this bracket.'
}
