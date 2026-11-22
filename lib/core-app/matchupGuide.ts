/**
 * The headline of a league's Matchup page in plain words (2026-11-13). The owner's ask: users should
 * know what the page is for. The question people open it with is "am I winning?" — the scoreboard
 * already holds the answer; this says it in one sentence, using the same rule the margin chip does
 * (scored points once anyone has played, the projection before).
 *
 * Pure, so the rule is testable and the screen stays a renderer.
 */
type MatchupWeekState = 'upcoming' | 'live' | 'final'

type MatchupHeadline =
  | { kind: 'final'; result: 'won' | 'lost' | 'tied'; you: number; them: number }
  | { kind: 'live'; leader: 'you' | 'them' | 'level'; margin: number; pWin: number | null }
  | { kind: 'projected'; leader: 'you' | 'them' | 'level'; you: number; them: number; pWin: number | null }
  | { kind: 'unknown' }

export function matchupHeadline(input: {
  weekState: MatchupWeekState
  scored: { you: number; opponent: number } | null
  projected: { you: number; opponent: number } | null
  pWin: number | null
}): MatchupHeadline {
  const lead = (a: number, b: number): 'you' | 'them' | 'level' => (a > b ? 'you' : a < b ? 'them' : 'level')
  const { scored, projected } = input
  if (input.weekState === 'final' && scored) {
    const l = lead(scored.you, scored.opponent)
    return { kind: 'final', result: l === 'you' ? 'won' : l === 'them' ? 'lost' : 'tied', you: scored.you, them: scored.opponent }
  }
  if (input.weekState === 'live' && scored) {
    return { kind: 'live', leader: lead(scored.you, scored.opponent), margin: Math.abs(scored.you - scored.opponent), pWin: input.pWin }
  }
  if (projected) {
    return { kind: 'projected', leader: lead(projected.you, projected.opponent), you: projected.you, them: projected.opponent, pWin: input.pWin }
  }
  return { kind: 'unknown' }
}

/** Whole percent, or null — a probability the model did not produce is not printed as 0%. */
export function pct(p: number | null): number | null {
  return p == null || !Number.isFinite(p) ? null : Math.round(p * 100)
}
