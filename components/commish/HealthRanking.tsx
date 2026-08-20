'use client'

/**
 * 11a — the league health ranking and the 7-day activity trend rails.
 *
 * ⚠ A LEAGUE WITH NO SCORE RANKS LAST AND SHOWS AN EM DASH. Not a zero, not a
 * greyed-out estimate, and not "insufficient evidence" dressed up as a low
 * score. `score: null` is a different claim from `score: 12` and only the dash
 * makes that visible — the same rule the attention queue applies to a failed
 * sync, and the same one 11b applies to the headline number.
 *
 * ⚠ THE SCORES HERE MUST MATCH 11b'S DETAIL VIEW. Both read
 * `CommissionerLeagueHealthSnapshot.healthScore` — this component never rounds,
 * rescales or re-derives, because a ranking that disagrees with the page it
 * links to is worse than no ranking.
 */

import Link from 'next/link'

export type HealthRankRow = {
  leagueId: string
  name: string
  badge: string
  score: number | null
  /** "healthy · improving" — status and trend, already humanised by the caller. */
  subtitle: string
  href?: string
}

export type TrendRow = {
  leagueId: string
  name: string
  /** Net 7-day activity delta. `null` when the league could not be read. */
  delta: number | null
}

function toneForScore(score: number | null): 'good' | 'warn' | 'bad' | 'none' {
  if (score == null || !Number.isFinite(score)) return 'none'
  if (score >= 75) return 'good'
  if (score >= 50) return 'warn'
  return 'bad'
}

export function HealthRanking({ rows }: { rows: HealthRankRow[] }) {
  if (rows.length === 0) return null

  // Scored leagues first, best to worst; unscored sink to the bottom.
  const ordered = [...rows].sort((a, b) => {
    if (a.score == null && b.score == null) return a.name.localeCompare(b.name)
    if (a.score == null) return 1
    if (b.score == null) return -1
    return b.score - a.score
  })

  return (
    <div className="af-card" style={{ padding: 16 }} data-testid="health-ranking">
      <div className="af-cm-tile-label" style={{ marginBottom: 12 }}>
        League health ranking
        <button
          type="button"
          className="af-cm-help"
          title="A 0–100 composite of engagement, fairness and sustainability per league. A league that has not synced shows no score rather than a guessed one."
          aria-label="About the health ranking"
        >
          ?
        </button>
      </div>
      <ul className="af-cm-rank">
        {ordered.map((row) => {
          const inner = (
            <>
              <span className="af-cm-badge">{row.badge}</span>
              <span style={{ minWidth: 0 }}>
                <span className="af-cm-rank-name" style={{ display: 'block' }}>
                  {row.name}
                </span>
                <span className="af-cm-rank-sub">{row.subtitle}</span>
              </span>
              <span className="af-cm-rank-score af-num" data-tone={toneForScore(row.score)}>
                {row.score != null ? Math.round(row.score) : '—'}
              </span>
            </>
          )
          return (
            <li key={row.leagueId} className="af-cm-rank-row">
              {row.href ? (
                <Link
                  href={row.href}
                  style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', minWidth: 0 }}
                >
                  {inner}
                </Link>
              ) : (
                inner
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function ActivityTrend({ rows }: { rows: TrendRow[] }) {
  if (rows.length === 0) return null
  return (
    <div className="af-card" style={{ padding: 16 }} data-testid="activity-trend">
      <div className="af-cm-tile-label" style={{ marginBottom: 8 }}>
        Activity trend · 7 days
      </div>
      {rows.map((row) => {
        /*
         * Zero is genuinely "flat" — the league was read and nothing moved. That
         * is different from `null`, which is "we could not read it", so the two
         * render differently even though both are quiet.
         */
        const dir = row.delta == null ? 'flat' : row.delta > 0 ? 'up' : row.delta < 0 ? 'down' : 'flat'
        const label =
          row.delta == null ? '—' : row.delta === 0 ? 'flat' : `${row.delta > 0 ? '▲ +' : '▼ '}${row.delta}`
        return (
          <div key={row.leagueId} className="af-cm-trend">
            <span className="af-cm-trend-name">{row.name}</span>
            <span className="af-cm-trend-val af-num" data-dir={dir}>
              {label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default HealthRanking
