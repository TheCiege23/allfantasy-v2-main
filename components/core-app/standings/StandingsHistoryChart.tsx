'use client'

import { useMemo, useState } from 'react'
import type { StandingsBoard } from '@/lib/core-app/standingsModel'

/**
 * Standings history — every team's position, week by week (a bump chart).
 *
 * ⚠ EMPHASIS, NOT A RAINBOW. Twelve teams are twelve series, past the point where hues stay
 * distinguishable, so every line is the same muted ink and only two are lifted: yours (accent) and the
 * one being pointed at or focused. The team list under the chart is the keyboard route to the same
 * highlight, and the table in the disclosure carries every number without hovering at all.
 *
 * Positions come from `board.history`, which is rebuilt from weekly results with the table's own rule —
 * the chart and the Move column cannot disagree.
 */

const W = 640
const PAD_L = 34
const PAD_R = 28
const PAD_T = 14
const PAD_B = 26

export function StandingsHistoryChart({
  board,
  metric,
  focusIds,
}: {
  board: StandingsBoard
  metric: 'seed' | 'powerRank'
  /** When a division is selected, only its teams are drawn at full weight. */
  focusIds: Set<string> | null
}) {
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [hoverWeek, setHoverWeek] = useState<number | null>(null)
  const teams = board.teams
  const weeks = board.weeks
  const n = Math.max(teams.length, 2)
  const rowH = n > 16 ? 16 : 22
  const H = PAD_T + PAD_B + (n - 1) * rowH
  const x = (i: number) => PAD_L + (weeks.length === 1 ? 0 : (i / (weeks.length - 1)) * (W - PAD_L - PAD_R))
  const y = (pos: number) => PAD_T + (pos - 1) * rowH
  const you = teams.find((t) => t.isYou) ?? null
  const label = metric === 'seed' ? 'place in the table' : 'AF Power rank'

  const byWeek = useMemo(
    () =>
      weeks.map((week, i) =>
        teams
          .map((t) => ({ id: t.rosterId, name: t.name, pos: board.history[t.rosterId]?.[i]?.[metric] ?? null }))
          .filter((r): r is { id: string; name: string; pos: number } => r.pos != null)
          .sort((a, b) => a.pos - b.pos)
          .map((r) => ({ ...r, week })),
      ),
    [board.history, metric, teams, weeks],
  )

  if (weeks.length < 2) {
    return (
      <p className="af-stb-empty">
        The history starts once two weeks are final — there {weeks.length === 1 ? 'is one' : 'are none'} so far.
      </p>
    )
  }

  const highlighted = hoverId ?? you?.rosterId ?? null
  const ordered = [...teams].sort((a, b) => {
    // Paint order: muted first, focus next, the highlighted line last so it sits on top.
    const rank = (id: string) => (id === highlighted ? 3 : id === you?.rosterId ? 2 : focusIds && focusIds.has(id) ? 1 : 0)
    return rank(a.rosterId) - rank(b.rosterId)
  })
  const hoverIdx = hoverWeek != null ? weeks.indexOf(hoverWeek) : -1

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - box.left) / box.width) * W
    let best = 0
    for (let i = 1; i < weeks.length; i += 1) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i
    setHoverWeek(weeks[best])
  }

  return (
    <figure className="af-stb-chart">
      <div className="af-stb-chart-plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`${you ? `Your ${label} by week: ${(board.history[you.rosterId] ?? []).map((p) => `week ${p.week} ${p[metric]}`).join(', ')}. ` : ''}Every team's weekly ${label} is in the table below the chart.`}
          onPointerMove={onMove}
          onPointerLeave={() => setHoverWeek(null)}
        >
          {/* Rank gridlines, recessive. */}
          {Array.from({ length: n }, (_, i) => (
            <line key={`g${i}`} className="af-stb-grid" x1={PAD_L} x2={W - PAD_R} y1={y(i + 1)} y2={y(i + 1)} />
          ))}
          {[1, Math.ceil(n / 2), n].map((pos) => (
            <text key={`y${pos}`} className="af-stb-axis" x={PAD_L - 8} y={y(pos) + 3} textAnchor="end">
              {pos}
            </text>
          ))}
          {weeks.map((w, i) => (
            <text key={`x${w}`} className="af-stb-axis" x={x(i)} y={H - 8} textAnchor="middle">
              W{w}
            </text>
          ))}
          {hoverIdx >= 0 ? <line className="af-stb-cross" x1={x(hoverIdx)} x2={x(hoverIdx)} y1={PAD_T - 6} y2={H - PAD_B + 6} /> : null}
          {ordered.map((t) => {
            const pts = (board.history[t.rosterId] ?? []).map((p, i) => `${x(i).toFixed(1)},${y(p[metric]).toFixed(1)}`).join(' ')
            const tone =
              t.rosterId === highlighted && t.rosterId !== you?.rosterId
                ? 'hover'
                : t.rosterId === you?.rosterId
                  ? 'you'
                  : focusIds && !focusIds.has(t.rosterId)
                    ? 'faded'
                    : 'muted'
            const last = board.history[t.rosterId]?.[weeks.length - 1]
            return (
              <g key={t.rosterId} data-tone={tone} className="af-stb-series">
                <polyline className="af-stb-line" points={pts} />
                {/* A wide invisible stroke: the pointer only has to be near the line. */}
                <polyline
                  className="af-stb-hit"
                  points={pts}
                  onPointerEnter={() => setHoverId(t.rosterId)}
                  onPointerLeave={() => setHoverId(null)}
                />
                {tone === 'you' || tone === 'hover'
                  ? (board.history[t.rosterId] ?? []).map((p, i) => (
                      <circle key={p.week} className="af-stb-dot" cx={x(i)} cy={y(p[metric])} r={4.5} />
                    ))
                  : null}
                {(tone === 'you' || tone === 'hover') && last ? (
                  <text className="af-stb-endlabel" x={W - PAD_R + 6} y={y(last[metric]) + 3}>
                    {last[metric]}
                  </text>
                ) : null}
              </g>
            )
          })}
        </svg>
        {hoverIdx >= 0 ? (
          <div
            className="af-stb-tip"
            role="status"
            style={{ left: `${Math.min(78, Math.max(4, (x(hoverIdx) / W) * 100))}%` }}
          >
            <strong>Week {weeks[hoverIdx]}</strong>
            <ol>
              {byWeek[hoverIdx].slice(0, 12).map((r) => (
                <li key={r.id} data-you={r.id === you?.rosterId ? 'true' : undefined}>
                  <span className="af-num">{r.pos}</span> {r.name}
                </li>
              ))}
            </ol>
            {byWeek[hoverIdx].length > 12 ? <small>+{byWeek[hoverIdx].length - 12} more in the table</small> : null}
          </div>
        ) : null}
      </div>
      <figcaption className="af-stb-chart-cap">
        Higher is better — first place is the top line.{' '}
        {you ? 'Your line is highlighted; point at or focus a team to trace theirs.' : 'Point at or focus a team to trace its line.'}
      </figcaption>
      <ul className="af-stb-keys" aria-label="Trace a team">
        {teams.map((t) => (
          <li key={t.rosterId}>
            <button
              type="button"
              aria-pressed={hoverId === t.rosterId}
              data-you={t.isYou ? 'true' : undefined}
              onMouseEnter={() => setHoverId(t.rosterId)}
              onMouseLeave={() => setHoverId(null)}
              onFocus={() => setHoverId(t.rosterId)}
              onBlur={() => setHoverId(null)}
            >
              {t.name}
            </button>
          </li>
        ))}
      </ul>
      <details className="af-stb-datatable">
        <summary>Positions by week, as a table</summary>
        <div className="af-stb-scroll" role="region" aria-label="Positions by week" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th scope="col">Team</th>
                {weeks.map((w) => (
                  <th key={w} scope="col" className="af-num">
                    W{w}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr key={t.rosterId} data-you={t.isYou ? 'true' : undefined}>
                  <th scope="row">{t.name}</th>
                  {weeks.map((w, i) => (
                    <td key={w} className="af-num">
                      {board.history[t.rosterId]?.[i]?.[metric] ?? '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}
