import type { RailMatchup } from '@/lib/core-app/railMatchups'

/**
 * "How am I doing across my leagues?" — the strip at the top of the cross-league live screen.
 *
 * ⚠ NO NEW SCORE. Every number here is the shell rail's own `getRailMatchups` read (the same rows the
 * left rail and the War Room strip draw), so this cannot disagree with them. This module only decides
 * which leagues need a look and how to say each one.
 *
 * Rules copied from those surfaces rather than invented: an unplayed fixture is "not started", never
 * 0–0; an elimination week shows rank and the cut, because there is no opponent; a chopped team is out
 * of the field and is not counted.
 */

export type LeagueRef = { id: string; name: string; sport: string }

export type GlanceStatus =
  | 'ahead'
  | 'behind'
  | 'level'
  | 'pending'
  /** Elimination week, at or below the cut. */
  | 'block'
  /** Elimination week, above the cut. */
  | 'clear'
  /** No opponent and no elimination: rank only. */
  | 'rank'
  /** No opponent and no rank we can stand behind. */
  | 'unknown'

export type GlanceRow = {
  leagueId: string
  leagueName: string
  status: GlanceStatus
  /** You minus them, or points over the cut in an elimination week. Null when there is no margin. */
  margin: number | null
  /** Inside the "close" band — see `isClose`. */
  close: boolean
  /** The one-line description drawn beside the league name. */
  line: string
}

export type LeaguesAtAGlance = {
  rows: GlanceRow[]
  /** Rows that need a look, most urgent first: on the block, then behind, then close. */
  attention: GlanceRow[]
  counts: { ahead: number; behind: number; level: number; close: number; pending: number }
}

/**
 * A margin inside 10% of the bigger score, or inside 5 points, is close.
 *
 * ⚠ A MARGIN RULE, NOT A WIN PROBABILITY, AND THE STRIP SAYS SO. The rail read carries no win
 * probability, and computing one here would be a second answer to a question `/core/matchup` already
 * owns. Proportional so it means the same thing in a 120-point NFL week and a 1,000-point NBA one.
 */
export function isClose(you: number, them: number): boolean {
  const margin = Math.abs(you - them)
  return margin <= Math.max(5, 0.1 * Math.max(Math.abs(you), Math.abs(them)))
}

/** Elimination: this many places or fewer above the cut is close. */
const BUBBLE_PLACES = 2

const pts = (n: number) => n.toFixed(1)

function classify(m: RailMatchup): Omit<GlanceRow, 'leagueId' | 'leagueName'> | null {
  if (m.eliminated) return null
  const lastImport = m.source === 'history_fallback' ? ' · last import' : ''

  if (m.unpaired) {
    const s = m.standing
    if (!s) return { status: 'unknown', margin: null, close: false, line: 'No head-to-head this week' }
    const basis = s.basis === 'projected' ? ' (projected)' : ''
    const place = `#${s.rank} of ${s.outOf}`
    if (!s.elimination) return { status: 'rank', margin: null, close: false, line: `${place}${basis}` }
    if (s.overCut == null || s.placesAboveCut === 0) {
      return { status: 'block', margin: s.overCut ?? 0, close: true, line: `${place} · on the block${basis}` }
    }
    return {
      status: 'clear',
      margin: s.overCut,
      close: s.placesAboveCut <= BUBBLE_PLACES,
      line: `${place} · ${pts(s.overCut)} over the cut${basis}`,
    }
  }

  if (!m.scored) return { status: 'pending', margin: null, close: false, line: 'Not started' }

  const margin = Math.round((m.yourScore - m.opponentScore) * 100) / 100
  const score = `${pts(m.yourScore)}–${pts(m.opponentScore)}`
  if (Math.abs(margin) < 0.05) return { status: 'level', margin: 0, close: true, line: `${score} · level${lastImport}` }
  return {
    status: margin > 0 ? 'ahead' : 'behind',
    margin,
    close: isClose(m.yourScore, m.opponentScore),
    line: `${score} · ${margin > 0 ? 'ahead' : 'behind'} by ${pts(Math.abs(margin))}${lastImport}`,
  }
}

/** On the block, then behind, then close leads, then the rest; most behind first inside each. */
function urgency(r: GlanceRow): number {
  if (r.status === 'block') return 0
  if (r.status === 'behind') return 1
  if (r.close) return 2
  if (r.status === 'ahead' || r.status === 'clear') return 3
  if (r.status === 'pending') return 4
  return 5
}

export function buildLeaguesAtAGlance(
  byLeague: Readonly<Record<string, RailMatchup>> | null | undefined,
  leagues: readonly LeagueRef[],
  sport: string | null,
): LeaguesAtAGlance | null {
  if (!byLeague) return null
  const rows: GlanceRow[] = []
  for (const league of leagues) {
    if (sport && league.sport !== sport) continue
    const m = byLeague[league.id]
    if (!m) continue
    const c = classify(m)
    if (c) rows.push({ leagueId: league.id, leagueName: league.name, ...c })
  }
  if (rows.length === 0) return null

  rows.sort(
    (a, b) =>
      urgency(a) - urgency(b) ||
      (a.margin ?? Number.POSITIVE_INFINITY) - (b.margin ?? Number.POSITIVE_INFINITY) ||
      a.leagueName.localeCompare(b.leagueName),
  )

  const counts = { ahead: 0, behind: 0, level: 0, close: 0, pending: 0 }
  for (const r of rows) {
    if (r.status === 'ahead' || r.status === 'clear') counts.ahead++
    else if (r.status === 'behind' || r.status === 'block') counts.behind++
    else if (r.status === 'level') counts.level++
    else if (r.status === 'pending') counts.pending++
    if (r.close) counts.close++
  }

  return { rows, attention: rows.filter((r) => urgency(r) <= 2), counts }
}
