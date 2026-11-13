/**
 * DraftBoardRenderer — pure helpers for draft board: pick label, snake/3RR slot, cell key.
 * Actual UI remains in DraftRoom and LeagueDraftBoard; this module provides consistent logic.
 */

export type PickCell = {
  round: number
  slotInRound: number
  overall: number
  pickLabel: string
  isSnakeReversed: boolean
}

type RoundNavigationState = {
  round: number
  canGoPrev: boolean
  canGoNext: boolean
  label: string
}

/**
 * Compute slot index in round (0-based) for a given overall pick.
 * Handles snake and 3rd-round reversal.
 */
export function getSlotInRound(
  overall: number,
  teamCount: number,
  draftFormat: 'snake' | 'linear' | 'auction',
  enable3RR: boolean
): number {
  const round = Math.ceil(overall / teamCount)
  let slotInRound = (overall - 1) % teamCount
  const isSnakeRound = draftFormat === 'snake' && round % 2 === 0
  const is3rrRound = enable3RR && round >= 3 && round % 2 === 1
  if (isSnakeRound || is3rrRound) {
    slotInRound = teamCount - 1 - slotInRound
  }
  return slotInRound
}

/**
 * Format pick label (e.g. "1.01", "2.12").
 */
export function formatPickLabel(overall: number, teamCount: number): string {
  const round = Math.ceil(overall / teamCount)
  const pickInRound = ((overall - 1) % teamCount) + 1
  return `${round}.${pickInRound.toString().padStart(2, '0')}`
}

/**
 * Build grid cell key for a round/slot (for React keys).
 */
export function getCellKey(round: number, slotIndex: number): string {
  return `${round}-${slotIndex}`
}

/**
 * Build board navigation state for round-by-round viewing.
 */
export function getRoundNavigationState(round: number, totalRounds: number): RoundNavigationState {
  const safeTotal = Math.max(1, totalRounds)
  const safeRound = Math.min(safeTotal, Math.max(1, round))
  return {
    round: safeRound,
    canGoPrev: safeRound > 1,
    canGoNext: safeRound < safeTotal,
    label: `Round ${safeRound} of ${safeTotal}`,
  }
}
