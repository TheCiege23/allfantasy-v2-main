'use client'

import type { ReactNode } from 'react'
import { useStatTableLayouts } from '@/components/stat-table/useStatTableLayouts'
import { fmt1 } from '@/lib/league/native/nativeScreenModels'
import type { WeekByPlayer } from '@/lib/league/native/weekByPlayer'

/**
 * Each player's points day by day this week, his week total, and what he scored on the bench —
 * the lineup screen of a daily-lineup league. Model: lib/league/native/weekByPlayer.ts.
 *
 * A counted day is plain; a day he scored on the bench is dimmed and marked, never coloured red or
 * green (one of the complaints about the redesign this answers). Name, week total and bench come
 * first, so a phone shows the totals without scrolling; the days scroll sideways after them.
 */

function dayHead(day: string): { dow: string; date: string } {
  const d = new Date(`${day}T12:00:00Z`)
  return {
    dow: d.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' }),
    date: String(d.getUTCDate()),
  }
}

export function WeekByPlayerCard({
  data,
  renderName,
}: {
  data: WeekByPlayer
  /** The player's name as the screen shows it (a button that opens his card). */
  renderName: (playerId: string) => ReactNode
}) {
  const { density } = useStatTableLayouts()
  if (data.rows.length === 0) return null
  // A day's total shows once someone on the roster has a line that day; until then it is blank, not 0.0.
  const dayPlayed = new Set(data.rows.flatMap((r) => r.cells.filter((c) => c.pts != null).map((c) => c.day)))
  return (
    <section className="nls-card nls-card-flush nls-wbp" aria-label={`Week ${data.week} by player`} data-testid="week-by-player" data-density={density}>
      {/* The week total is the day picker's "Week N so far" line and this table's Total row — not a third time here. */}
      <h3 className="nls-label nls-card-head">
        <span>Week {data.week} by player</span>
      </h3>
      <div className="nls-wbp-scroll">
        <table className="nls-wbp-table">
          <thead>
            <tr>
              <th scope="col" className="nls-wbp-pin">Player</th>
              <th scope="col" className="nls-wbp-total" title="Points that counted toward your matchup">Week</th>
              <th scope="col" className="nls-wbp-split" title="Points scored while on your bench">Bench</th>
              {data.days.map((d) => {
                const h = dayHead(d.day)
                return (
                  <th key={d.day} scope="col" data-today={d.status === 'today' || undefined}>
                    <span className="nls-wbp-dow">{h.dow}</span>
                    <span className="nls-wbp-date">{h.date}</span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.playerId} data-testid={`week-by-player-${r.playerId}`}>
                <th scope="row" className="nls-wbp-pin">{renderName(r.playerId)}</th>
                <td className="nls-wbp-total">{fmt1(r.week)}</td>
                <td className="nls-wbp-bench nls-wbp-split">{r.bench > 0 ? fmt1(r.bench) : '–'}</td>
                {r.cells.map((c) =>
                  !c.onRoster ? (
                    <td key={c.day} className="nls-wbp-off" aria-label="Not on your roster" />
                  ) : c.pts == null ? (
                    <td key={c.day} className="nls-wbp-none">·</td>
                  ) : c.counted ? (
                    <td key={c.day}>{fmt1(c.pts)}</td>
                  ) : (
                    <td key={c.day} className="nls-wbp-bench" title="Scored on your bench — did not count">
                      {fmt1(c.pts)}
                      <span className="nls-wbp-bn" aria-label="on bench">BN</span>
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="nls-wbp-pin">Total</th>
              <td className="nls-wbp-total">{fmt1(data.total)}</td>
              <td className="nls-wbp-bench nls-wbp-split">{data.benchTotal > 0 ? fmt1(data.benchTotal) : '–'}</td>
              {data.days.map((d) => (
                <td key={d.day}>{dayPlayed.has(d.day) ? fmt1(d.starterPoints) : ''}</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      {data.benchTotal > 0 ? (
        <p className="nls-muted nls-wbp-note" data-testid="week-by-player-bench-note">
          {fmt1(data.benchTotal)} pts were scored on your bench this week.
        </p>
      ) : null}
    </section>
  )
}
