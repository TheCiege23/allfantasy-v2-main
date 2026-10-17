/**
 * "This season" on the Player Finder card: every week so far, what he was projected, what he
 * scored, and how often the projection held.
 *
 * Pure and client-safe — the loader (playerDepth.ts) reads the rows; this folds them.
 *
 * ⚠ ONE RULER ON BOTH SIDES. The projection feed's points are Sleeper's PPR preset and a stat
 * line carries Sleeper's own `pts_ppr`, so the default view compares PPR with PPR. In a held
 * league BOTH sides are re-scored from their component lines under that league's
 * `scoring_settings` (lib/projections/leagueScoring.ts) — never a league-scored actual against a
 * PPR projection, which would manufacture an "error" out of the scoring difference.
 *
 * ⚠ A MISSING NUMBER IS NOT A ZERO. A week with a projection and no stat line is a week he did
 * not play (or the feed has not landed) and is kept out of every average; "scored 0" is a claim
 * the data does not make.
 */

export type SeasonWeek = {
  week: number
  opponent: string | null
  projected: number | null
  actual: number | null
  /** True when a stat line exists for the week (he appeared). */
  played: boolean
}

export type SeasonSummary = {
  games: number
  total: number
  average: number
  /** Weeks with BOTH a projection and a score. */
  compared: number
  /** Of `compared`, how many he met or beat. */
  beat: number
  /** Mean |projected − actual| over `compared`. */
  meanMiss: number | null
  best: { week: number; points: number } | null
  worst: { week: number; points: number } | null
}

export type PlayerSeason = {
  season: number
  /** 'ppr' everywhere, or the held league's own scoring. */
  scoring: { kind: 'ppr' } | { kind: 'league'; leagueName: string }
  weeks: SeasonWeek[]
  summary: SeasonSummary
}

const round1 = (n: number) => Math.round(n * 10) / 10

export function summarizeSeason(weeks: readonly SeasonWeek[]): SeasonSummary {
  const played = weeks.filter((w) => w.played && w.actual != null)
  const total = played.reduce((s, w) => s + (w.actual as number), 0)
  const compared = played.filter((w) => w.projected != null)
  const beat = compared.filter((w) => (w.actual as number) >= (w.projected as number)).length
  const missSum = compared.reduce((s, w) => s + Math.abs((w.actual as number) - (w.projected as number)), 0)
  let best: SeasonSummary['best'] = null
  let worst: SeasonSummary['worst'] = null
  for (const w of played) {
    const p = w.actual as number
    if (!best || p > best.points) best = { week: w.week, points: round1(p) }
    if (!worst || p < worst.points) worst = { week: w.week, points: round1(p) }
  }
  return {
    games: played.length,
    total: round1(total),
    average: played.length ? round1(total / played.length) : 0,
    compared: compared.length,
    beat,
    meanMiss: compared.length ? round1(missSum / compared.length) : null,
    best,
    worst,
  }
}

/** "Beat his projection in 2 of 3 weeks · missed by 6.1 on average" — or null when nothing compares. */
export function projectionHeadline(summary: SeasonSummary): string | null {
  if (summary.compared === 0) return null
  const weeks = summary.compared === 1 ? 'week' : 'weeks'
  const miss = summary.meanMiss != null ? ` · off by ${summary.meanMiss.toFixed(1)} a week on average` : ''
  return `Met or beat his projection in ${summary.beat} of ${summary.compared} ${weeks}${miss}`
}

/** A stat line's own Sleeper PPR total, or null. */
export function statLinePpr(statLine: unknown): number | null {
  if (!statLine || typeof statLine !== 'object') return null
  const v = (statLine as Record<string, unknown>).pts_ppr
  return typeof v === 'number' && Number.isFinite(v) ? round1(v) : null
}

/** The component stats only — the feed's own aggregates (`pts_*`, `adp_*`, `gp`) removed before a league re-score. */
export function componentStats(statLine: unknown): Record<string, number> | null {
  if (!statLine || typeof statLine !== 'object') return null
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(statLine as Record<string, unknown>)) {
    if (k.startsWith('pts_') || k.startsWith('adp_') || k === 'gp' || k === 'gs') continue
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
  }
  return Object.keys(out).length ? out : null
}
