/**
 * BracketScoringInfoResolver — scoring explanation and mode info for bracket UI.
 * Re-exports and extends lib/brackets/scoring for challenge-specific copy.
 */

import { pointsForRound } from '@/lib/brackets/scoring'

/**
 * Short summary of round points for tooltip or "How scoring works" panel.
 */
export function getRoundPointsSummary(roundPoints?: Record<number, number>): string {
  const parts: string[] = []
  for (let r = 1; r <= 6; r++) {
    const pts = pointsForRound(r, roundPoints)
    if (pts > 0) parts.push(`R${r}: ${pts} pt${pts !== 1 ? 's' : ''}`)
  }
  return parts.length ? parts.join(' · ') : 'Standard round points (1-2-4-8-16-32)'
}

/**
 * Label for "Scoring" or "How it works" link.
 */
export const SCORING_INFO_LABEL = 'How scoring works'
