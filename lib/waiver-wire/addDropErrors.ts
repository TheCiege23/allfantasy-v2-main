/**
 * Structured error codes for the free-agent add/drop surface (Step 3B).
 *
 * Maps the human messages thrown by `assertWaiverClaimEligibility` (and the league/roster gates)
 * to the stable codes the client maps to friendly UI copy. Drop-aware: a roster-limit message
 * means DROP_REQUIRED when no drop was provided, and ROSTER_FULL when one was.
 */

export type AddDropErrorCode =
  | 'PLAYER_UNAVAILABLE'
  | 'PLAYER_ALREADY_ROSTERED'
  | 'ROSTER_FULL'
  | 'DROP_REQUIRED'
  | 'INVALID_DROP'
  | 'PLAYER_LOCKED'
  | 'ROSTER_LOCKED'
  | 'WAIVER_REQUIRED'
  | 'LEAGUE_NOT_ACTIVE'
  | 'UNAUTHORIZED'
  | 'VALIDATION_FAILED'

export function mapAddDropErrorCode(message: string, opts: { hasDrop: boolean }): AddDropErrorCode {
  const m = message.toLowerCase()

  if (m.includes('unauthorized') || m.includes('not authorized') || m.includes('roster not found')) return 'UNAUTHORIZED'
  if (m.includes('season is complete') || m.includes('all roster moves are locked') || m.includes('league is not active') || m.includes('not active')) {
    return 'LEAGUE_NOT_ACTIVE'
  }
  if (m.includes('already on your roster')) return 'PLAYER_ALREADY_ROSTERED'
  if (m.includes('already on another roster') || m.includes('no longer available') || m.includes('unavailable')) return 'PLAYER_UNAVAILABLE'
  if (m.includes('must go through waivers') || m.includes('waiver required') || m.includes('on waivers')) return 'WAIVER_REQUIRED'
  if (m.includes('roster is locked by the commissioner')) return 'ROSTER_LOCKED'
  // Drop problems before generic roster-limit so an explicit bad drop is precise.
  if (m.includes('drop player is not on your roster') || m.includes('invalid drop') || m.includes('undroppable')) return 'INVALID_DROP'
  if (
    m.includes('starter is locked') ||
    m.includes('bench player is locked') ||
    m.includes('slot is locked') ||
    m.includes('lineup lock') ||
    (m.includes('locked') && !m.includes('all roster moves are locked'))
  ) {
    return 'PLAYER_LOCKED'
  }
  if (m.includes('at the limit') || m.includes('over the limit') || m.includes('roster full') || m.includes('choose a player to drop')) {
    return opts.hasDrop ? 'ROSTER_FULL' : 'DROP_REQUIRED'
  }
  return 'VALIDATION_FAILED'
}

/** HTTP status for an add/drop error code. */
export function addDropErrorStatus(code: AddDropErrorCode): number {
  switch (code) {
    case 'UNAUTHORIZED':
      return 401
    case 'PLAYER_LOCKED':
    case 'ROSTER_LOCKED':
      return 423
    case 'WAIVER_REQUIRED':
      return 409
    case 'PLAYER_ALREADY_ROSTERED':
      return 409
    case 'LEAGUE_NOT_ACTIVE':
      return 403
    default:
      return 400
  }
}

/** Friendly default copy per code (client may override). */
export const ADD_DROP_ERROR_COPY: Record<AddDropErrorCode, string> = {
  PLAYER_UNAVAILABLE: 'That player is no longer available.',
  PLAYER_ALREADY_ROSTERED: 'That player is already on your roster.',
  ROSTER_FULL: 'Your roster is full. Choose a player to drop.',
  DROP_REQUIRED: 'Your roster is full — select a player to drop to complete this add.',
  INVALID_DROP: 'That drop is not allowed.',
  PLAYER_LOCKED: 'That player is locked right now and cannot be moved.',
  ROSTER_LOCKED: 'The commissioner has locked this roster. Ask them to unlock it before making a move.',
  WAIVER_REQUIRED: 'This player must be claimed through waivers.',
  LEAGUE_NOT_ACTIVE: 'Roster moves are not open for this league right now.',
  UNAUTHORIZED: 'You are not allowed to make this move.',
  VALIDATION_FAILED: 'That move could not be completed.',
}
