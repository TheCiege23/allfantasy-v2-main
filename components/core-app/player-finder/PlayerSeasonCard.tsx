'use client'

import type { SectionState } from '@/lib/core-app/leagueHome'
import type { PlayerSeason } from '@/lib/core-app/playerSeason'
import { finderPlayerInfoCopy, infoReasonText } from '@/lib/core-app/finderPlayerInfoCopy'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

/**
 * "This season" — a bar per week (what he scored) with a tick for what he was projected, and the
 * few numbers a manager actually asks: total, per game, and how often the projection held.
 *
 * ⚠ THE SCORING IS NAMED ON THE CARD. PPR everywhere, or the held league's own scoring on BOTH
 * sides (playerSeason.ts). A bar and a tick on different rulers would draw a miss that is only
 * the scoring difference.
 *
 * ⚠ A WEEK HE DID NOT PLAY HAS NO BAR, NOT A ZERO BAR. The data says "no stat line", not "0".
 *
 * Spanish (2026-10-05): the words come from finderPlayerInfoCopy.ts at render — the headline rebuilt
 * from the summary's numbers, the loader's reason through `infoReasonText`. Numbers keep `toFixed`.
 */

const W = 320
const H = 120
const PAD_TOP = 14
const PAD_BOTTOM = 20

function fmt(n: number | null): string {
  return n == null ? '—' : n.toFixed(1)
}

export function PlayerSeasonCard({ state, name }: { state: SectionState<PlayerSeason>; name: string }) {
  const { language } = useOptionalLanguage()
  const t = finderPlayerInfoCopy(language)
  if (!state.available) {
    return (
      <section className="af-pf-block af-pf-season-card" aria-labelledby="af-pf-season-h">
        <h3 className="af-label" id="af-pf-season-h">
          {t.thisSeason}
        </h3>
        <p className="af-pf-unavailable">{infoReasonText(state.reason, language)}</p>
      </section>
    )
  }
  const { weeks, summary, scoring, season } = state.data
  const max = Math.max(1, ...weeks.flatMap((w) => [w.actual ?? 0, w.projected ?? 0]))
  const n = Math.max(weeks.length, 1)
  const slot = W / n
  const barW = Math.min(28, slot * 0.56)
  const y = (v: number) => PAD_TOP + (H - PAD_TOP - PAD_BOTTOM) * (1 - v / max)
  const base = H - PAD_BOTTOM
  const headline = t.headline(summary)
  const scoringLabel = scoring.kind === 'ppr' ? t.scoringPpr : t.scoringLeague(scoring.leagueName)

  return (
    <section className="af-pf-block af-pf-season-card" aria-labelledby="af-pf-season-h">
      <header className="af-pf-season-head">
        <h3 className="af-label" id="af-pf-season-h">
          {t.thisSeasonOf(season)}
        </h3>
        <span className="af-pf-season-scoring af-num">{scoringLabel}</span>
      </header>

      <dl className="af-pf-season-stats-row">
        <div>
          <dt className="af-label">{t.points}</dt>
          <dd className="af-num">{summary.total.toFixed(1)}</dd>
        </div>
        <div>
          <dt className="af-label">{t.perGame}</dt>
          <dd className="af-num">{summary.games ? summary.average.toFixed(1) : '—'}</dd>
        </div>
        <div>
          <dt className="af-label">{t.games}</dt>
          <dd className="af-num">{summary.games}</dd>
        </div>
        <div>
          <dt className="af-label">{t.best}</dt>
          <dd className="af-num">{summary.best ? t.bestValue(summary.best.points.toFixed(1), summary.best.week) : '—'}</dd>
        </div>
      </dl>

      <svg
        className="af-pf-season-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={t.chartAria(
          name,
          weeks.map((w) => t.chartWeek(w.week, w.played && w.actual != null ? w.actual.toFixed(1) : null, w.projected != null ? w.projected.toFixed(1) : null)),
        )}
      >
        <line x1={0} x2={W} y1={base} y2={base} className="af-pf-season-axis" />
        {weeks.map((w, i) => {
          const cx = slot * i + slot / 2
          const beat = w.actual != null && w.projected != null ? w.actual >= w.projected : null
          return (
            <g key={w.week} data-beat={beat == null ? undefined : String(beat)}>
              {w.played && w.actual != null ? (
                <rect x={cx - barW / 2} y={y(w.actual)} width={barW} height={Math.max(1, base - y(w.actual))} rx={3} className="af-pf-season-bar" />
              ) : null}
              {w.projected != null ? <line x1={cx - barW / 2 - 3} x2={cx + barW / 2 + 3} y1={y(w.projected)} y2={y(w.projected)} className="af-pf-season-proj" /> : null}
              <text x={cx} y={H - 6} textAnchor="middle" className="af-pf-season-wk">
                {w.week}
              </text>
            </g>
          )
        })}
      </svg>
      <p className="af-pf-season-legend">
        <span className="af-pf-season-key af-pf-season-key--bar" aria-hidden /> {t.scored}
        <span className="af-pf-season-key af-pf-season-key--proj" aria-hidden /> {t.projected}
        {headline ? <span className="af-pf-season-headline"> · {headline}</span> : null}
      </p>

      <table className="af-pf-season-table">
        <thead>
          <tr>
            <th className="af-label">{t.colWeek}</th>
            <th className="af-label">{t.colOpp}</th>
            <th className="af-label">{t.colProj}</th>
            <th className="af-label">{t.colScored}</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.week} data-beat={w.actual != null && w.projected != null ? String(w.actual >= w.projected) : undefined}>
              <td className="af-num">{w.week}</td>
              <td>{w.opponent ?? '—'}</td>
              <td className="af-num">{fmt(w.projected)}</td>
              <td className="af-num">{w.played ? fmt(w.actual) : t.noStats}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

export default PlayerSeasonCard
