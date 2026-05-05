/**
 * Pure helpers for DraftRoom primary pick affordances (snake/linear — not auction nominate/bid).
 */

/** Primary "Draft" / make-pick button for the active player row when user is on the clock. */
export function isSnakeMakePickButtonEnabled(input: {
  canDraft: boolean
  isCurrentUserOnClock: boolean
  pickSubmitting: boolean
}): boolean {
  return input.canDraft && input.isCurrentUserOnClock && !input.pickSubmitting
}
