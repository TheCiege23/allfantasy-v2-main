/**
 * The league Overview's headline in plain words (2026-11-13). The owner's ask: users should know what
 * the page is for and exactly what to do. The question people open a league with is "how am I doing in
 * this league, and what's this week?" — and the answer depends on the format:
 *
 *   head-to-head   your place, your record, and who you play this week
 *   elimination    your place among the teams still alive, and how far above the cut you are
 *   before a draft there is nothing to stand on yet
 *
 * ⚠ AN ELIMINATION LEAGUE IS ANSWERED FROM THE RAIL'S OWN STANDING, NOT THE KPI ROW. On the owner's
 * Guillotine League 26 the Overview said "Record 0-0 · 2nd of 18" while the rail beside it said "6th of 7
 * alive · +12.4 over the cut" — a W-L record means nothing in a league with no matchups, and the 18 counted
 * teams already chopped. Both surfaces now read the same `RailMatchup`.
 *
 * Pure, so the rules are testable and the screen stays a renderer.
 */
import type { RailMatchup } from '@/lib/core-app/railMatchups'

export type OverviewHeadline =
  /** Your team was eliminated. */
  | { kind: 'chopped'; week: number | null }
  /** Alive in an elimination league. `overCut` null = you ARE the lowest score this week. */
  | { kind: 'alive'; rank: number; outOf: number; overCut: number | null; placesAboveCut: number | null }
  /** Elimination league, but the field cannot be ranked yet (no scores, before the first chop). */
  | { kind: 'aliveUnranked'; outOf: number | null }
  | { kind: 'preDraft' }
  | { kind: 'h2h'; rank: number | null; teams: number | null; record: string; opponent: string | null; winPct: number | null }
  | { kind: 'none' }

/** Does this league chop the bottom team each week (rather than play head-to-head)? */
export function isEliminationLeague(rail: RailMatchup | null | undefined, variant?: string | null): boolean {
  if (rail?.guillotine) return true
  if (rail?.eliminated) return true
  if (rail?.standing?.elimination) return true
  const v = String(variant ?? '').toLowerCase()
  return v.includes('guillotine')
}

export function overviewHeadline(input: {
  rail: RailMatchup | null | undefined
  variant?: string | null
  /** No scores, no draft yet (LeagueHomeData.preSeason with an empty roster). */
  preDraft: boolean
  record: { record: string; rank: number | null; teams: number | null } | null
  matchup: { opponent: string; pWin: number | null } | null
}): OverviewHeadline {
  const { rail } = input
  if (input.preDraft) return { kind: 'preDraft' }
  if (isEliminationLeague(rail, input.variant)) {
    const g = rail?.guillotine ?? null
    if (rail?.eliminated || g?.state === 'eliminated') return { kind: 'chopped', week: g?.choppedWeek ?? null }
    if (g) {
      if (g.state === 'preseason') return { kind: 'preDraft' }
      if (g.rank != null && g.chopMargin != null) {
        return { kind: 'alive', rank: g.rank, outOf: g.aliveCount, overCut: g.chopMargin > 0 ? g.chopMargin : null, placesAboveCut: null }
      }
      return { kind: 'aliveUnranked', outOf: g.aliveCount || null }
    }
    const s = rail?.standing ?? null
    if (s) return { kind: 'alive', rank: s.rank, outOf: s.outOf, overCut: s.overCut, placesAboveCut: s.placesAboveCut }
    return { kind: 'aliveUnranked', outOf: null }
  }
  if (input.record) {
    return {
      kind: 'h2h',
      rank: input.record.rank,
      teams: input.record.teams,
      record: input.record.record,
      opponent: input.matchup?.opponent ?? null,
      winPct: input.matchup?.pWin != null ? Math.round(Math.max(0, Math.min(1, input.matchup.pWin)) * 100) : null,
    }
  }
  return { kind: 'none' }
}
