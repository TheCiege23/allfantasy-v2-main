/**
 * The top of /core/rankings in plain words (2026-11-14).
 *
 * The owner's ask, for every /core page: users should know what the page is for and what to do. The page
 * opened on "Rankings" over two sentences about separate boards, and the fact a manager came for — "you
 * are #18 of 19" — was a small pill, then said again in a "You on Overall" box, the board's heading, and
 * the highlighted row. This reads the data the page already loads into one headline per tab, and one
 * line for how your place has moved.
 *
 * Pure, so the rules are testable and the screen stays a renderer.
 */
import type { Movement, RankingsData } from '@/lib/core-app/rankings'

export type RankingsHeadline =
  /** Your place on a community board. `next` is the manager directly above you, when there is one. */
  | { kind: 'board'; rank: number; of: number; board: string | null; next: { handle: string; gap: number | null } | null }
  /** Signed in but not on this board — it needs `min` league-seasons with results. */
  | { kind: 'notRanked'; min: number }
  /** Your portfolio's AF manager score, and your community rank when you have one. */
  | { kind: 'portfolio'; score: number; rank: { rank: number; of: number } | null }
  | { kind: 'portfolioEmpty' }
  /** Your place in one league's standings. */
  | { kind: 'league'; rank: number; of: number; league: string }
  | { kind: 'leaguePick' }
  /** Your Class: an established rating has a division; a provisional one is still settling. */
  | { kind: 'class'; division: number; rating: number }
  | { kind: 'classProvisional'; games: number }
  /** Nothing about you to say (signed out, or a tab with no data): the page says what it is for. */
  | { kind: 'about'; scope: RankingsData['scope'] }

/**
 * "30.3" and "25.9" → 4.4. Only plain numbers: a board whose metric reads "58.8%" or "3 / 1.2" is not
 * subtracted, because "4.4 behind" would not say what unit it is in.
 */
export function plainGap(theirs: string, yours: string): number | null {
  const plain = /^-?\d+(?:\.\d+)?$/
  if (!plain.test(theirs.trim()) || !plain.test(yours.trim())) return null
  const gap = Number(theirs) - Number(yours)
  return Number.isFinite(gap) && gap > 0 ? Math.round(gap * 10) / 10 : null
}

export function rankingsHeadline(
  data: Pick<RankingsData, 'scope' | 'signedIn' | 'filters' | 'global' | 'portfolio' | 'league' | 'classView'>,
): RankingsHeadline {
  if (data.scope === 'global') {
    const g = data.global
    if (g?.you) {
      const rival = g.rivals[0] ?? null
      return {
        kind: 'board',
        rank: g.you.rank,
        of: g.you.of,
        board: g.board === 'overall' ? null : g.label,
        next: rival && g.you.rank > 1 ? { handle: rival.handle, gap: plainGap(rival.display, rival.yourDisplay) } : null,
      }
    }
    return data.signedIn ? { kind: 'notRanked', min: data.filters.minSample } : { kind: 'about', scope: 'global' }
  }
  if (data.scope === 'portfolio') {
    if (!data.signedIn) return { kind: 'about', scope: 'portfolio' }
    const score = data.portfolio?.score.score
    return score != null
      ? { kind: 'portfolio', score: Math.round(score * 10) / 10, rank: data.portfolio?.globalRank ?? null }
      : { kind: 'portfolioEmpty' }
  }
  if (data.scope === 'league') {
    const l = data.league
    if (!l?.selected) return { kind: 'leaguePick' }
    const rows = l.board?.available ? l.board.rows : []
    const me = rows.find((r) => r.isYou)
    return me ? { kind: 'league', rank: me.rank, of: rows.length, league: l.selected.name } : { kind: 'about', scope: 'league' }
  }
  const you = data.classView?.you
  if (you?.status === 'established' && you.division != null) return { kind: 'class', division: you.division, rating: Math.round(you.rating) }
  if (you) return { kind: 'classProvisional', games: you.games }
  return { kind: 'about', scope: 'class' }
}

/** Each change in places, newest window first; zero and unknown windows are left out. */
export function movementParts(m: Movement | null | undefined): Array<{ window: 'sevenDay' | 'week' | 'season'; places: number }> {
  if (!m) return []
  const out: Array<{ window: 'sevenDay' | 'week' | 'season'; places: number }> = []
  for (const window of ['week', 'sevenDay', 'season'] as const) {
    const places = m[window]
    if (places != null && places !== 0) out.push({ window, places })
  }
  /* "this week" and "in 7 days" usually say the same thing; keep the week when both are there and agree. */
  const week = out.find((p) => p.window === 'week')
  const seven = out.find((p) => p.window === 'sevenDay')
  return week && seven && week.places === seven.places ? out.filter((p) => p !== seven) : out
}
