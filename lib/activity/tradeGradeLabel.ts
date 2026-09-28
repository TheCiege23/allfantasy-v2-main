import type { ActivityTradeGrade } from '@/lib/activity/types'

/**
 * How a feed trade's grade reads, in words — shared by /core's Comms activity feed and the league
 * feed page so the two say the same thing. PURE and client-safe.
 *
 * The basis is always stated: a Sleeper trade's letter is on this league's values TODAY; a native
 * trade's is the one frozen when it was PROPOSED. Two different moments must not read as one.
 */
export function tradeGradeLabel(g: ActivityTradeGrade | null | undefined):
  | { kind: 'graded'; chips: Array<{ name: string; letter: 'A' | 'B' | 'C' | 'D' | 'F' }>; basis: string }
  | { kind: 'withheld'; line: string }
  | null {
  if (!g) return null
  if (!g.graded) return { kind: 'withheld', line: `Not graded: ${g.reason}` }
  return {
    kind: 'graded',
    chips: g.sides,
    basis: g.basis === 'today' ? 'on this league’s values today' : 'graded when it was proposed',
  }
}

/** Letter colours shared with the other trade surfaces. */
export const TRADE_LETTER_COLOR: Record<'A' | 'B' | 'C' | 'D' | 'F', string> = {
  A: '#34d399',
  B: '#5eead4',
  C: '#fbbf24',
  D: '#fb923c',
  F: '#fb5b78',
}
