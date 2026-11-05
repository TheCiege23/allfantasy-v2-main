'use client'

import type { CareerSeasonRow } from '@/lib/core-app/careerModel'
import { useMessages } from '@/components/i18n/useMessages'
import { careerSeasonBarsMessages } from '@/lib/core-app/messages/careerSeasonBars'

/**
 * Career → Season by season (board: Career, the 2026-11 redesign).
 *
 * One bar per season, its height that year's regular-season win rate on a fixed 0–100% axis, and a
 * star with the count for a year that produced a title. Every figure is a field of `CareerSeasonRow`
 * — nothing derived beyond rounding.
 *
 * ⚠ A YEAR WITH NO GAMES DRAWS NO BAR, NOT A ZERO ONE. `winRate` is null exactly when no games were
 * played, and a 0% bar would read as a winless season. It keeps its slot and says so instead.
 */
export function SeasonBars({ seasons }: { seasons: CareerSeasonRow[] }) {
  const m = useMessages(careerSeasonBarsMessages)
  if (seasons.length === 0) return null
  const rows = [...seasons].sort((a, b) => a.season - b.season)
  const pctOf = (s: CareerSeasonRow) => (s.winRate == null ? null : Math.round(s.winRate * 100))
  const best = rows.reduce<CareerSeasonRow | null>(
    (top, s) => (s.winRate != null && (top == null || (top.winRate ?? -1) < s.winRate) ? s : top),
    null,
  )

  return (
    <section className="af-c13-card af-crs" aria-labelledby="af-crs-title">
      <div className="af-crs-head">
        <div className="af-crs-headtext">
          <h2 id="af-crs-title" className="af-crs-title">
            {m.title}
          </h2>
          <p className="af-crs-note">{m.note}</p>
        </div>
        {best ? <span className="af-crs-best">{m.bestYear(best.season, pctOf(best)!)}</span> : null}
      </div>

      <div className="af-crs-plot">
        <div className="af-crs-axis" aria-hidden>
          <span>{m.axisTop}</span>
          <span>{m.axisMid}</span>
          <span>{m.axisBottom}</span>
        </div>
        <ol className="af-crs-bars" style={{ ['--af-crs-n' as string]: rows.length }}>
          {rows.map((s) => {
            const pct = pctOf(s)
            const record = s.ties ? `${s.wins}–${s.losses}–${s.ties}` : `${s.wins}–${s.losses}`
            return (
              <li
                key={s.season}
                className="af-crs-col"
                data-season={s.season}
                data-titles={s.championships || undefined}
                data-empty={pct == null ? 'true' : undefined}
                aria-label={m.barLabel(s.season, record, pct, s.championships)}
              >
                <span className="af-crs-track" aria-hidden>
                  {s.championships > 0 ? (
                    <span className="af-crs-star" style={{ bottom: `${pct ?? 0}%` }}>
                      ★ {s.championships}
                    </span>
                  ) : null}
                  {pct == null ? (
                    <span className="af-crs-none">{m.noGames}</span>
                  ) : (
                    <span className="af-crs-bar" style={{ height: `${Math.max(pct, 1)}%` }} />
                  )}
                </span>
                <span className="af-crs-year" aria-hidden>
                  {s.season}
                </span>
                <span className="af-crs-val" aria-hidden>
                  {pct == null ? '—' : `${pct}%`}
                </span>
              </li>
            )
          })}
        </ol>
      </div>
    </section>
  )
}
