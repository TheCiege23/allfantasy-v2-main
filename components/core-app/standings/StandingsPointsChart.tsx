'use client'

import { useState } from 'react'
import { formatRecord, type BoardTeam, type StandingsBoard } from '@/lib/core-app/standingsModel'

/**
 * The points picture — item 5 of the standings brief.
 *
 * Two small charts, both on ONE axis each (no dual scales):
 *  - points for against points against, with the league averages as the quadrant lines, so "scoring a
 *    lot and still losing" is a place on the page rather than a sentence;
 *  - actual wins against expected wins (from all-play), sorted by the gap, which is the schedule-luck
 *    reading in one glance. The all-play record rides along as text.
 *
 * Every team is the same muted mark; yours is the accent. Values are on hover and focus, and all of them
 * are also in the AF Power table.
 */

const W = 560
const H = 300
const PAD = { l: 48, r: 16, t: 16, b: 38 }

function pts(v: number): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 })
}

function niceBounds(values: number[]): [number, number] {
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const pad = Math.max(10, (hi - lo) * 0.08)
  return [Math.floor((lo - pad) / 10) * 10, Math.ceil((hi + pad) / 10) * 10]
}

function PointsScatter({ teams }: { teams: BoardTeam[] }) {
  const [hover, setHover] = useState<string | null>(null)
  const rows = teams.filter((t) => t.pointsAgainst != null && t.weeksPlayed > 0)
  if (rows.length < 2) return null
  const [x0, x1] = niceBounds(rows.map((t) => t.pointsFor))
  const [y0, y1] = niceBounds(rows.map((t) => t.pointsAgainst!))
  const sx = (v: number) => PAD.l + ((v - x0) / (x1 - x0)) * (W - PAD.l - PAD.r)
  const sy = (v: number) => H - PAD.b - ((v - y0) / (y1 - y0)) * (H - PAD.t - PAD.b)
  const avgX = rows.reduce((a, t) => a + t.pointsFor, 0) / rows.length
  const avgY = rows.reduce((a, t) => a + t.pointsAgainst!, 0) / rows.length
  const hovered = rows.find((t) => t.rosterId === hover) ?? null
  const ordered = [...rows].sort((a, b) => Number(a.isYou) - Number(b.isYou))

  return (
    <figure className="af-stb-chart">
      <figcaption className="af-stb-chart-title">
        <b>Points for vs points against</b>
        <small>Right = scores more. Up = has faced more. Lines are the league averages.</small>
      </figcaption>
      <div className="af-stb-chart-plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Points for against points against for ${rows.length} teams. ${rows
            .map((t) => `${t.name}: ${pts(t.pointsFor)} for, ${pts(t.pointsAgainst!)} against`)
            .join('; ')}.`}
        >
          <line className="af-stb-grid" x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} />
          <line className="af-stb-grid" x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={H - PAD.b} />
          <line className="af-stb-avg" x1={sx(avgX)} x2={sx(avgX)} y1={PAD.t} y2={H - PAD.b} />
          <line className="af-stb-avg" x1={PAD.l} x2={W - PAD.r} y1={sy(avgY)} y2={sy(avgY)} />
          <text className="af-stb-quad" x={W - PAD.r - 4} y={PAD.t + 10} textAnchor="end">
            Scoring, but facing a lot
          </text>
          <text className="af-stb-quad" x={W - PAD.r - 4} y={H - PAD.b - 6} textAnchor="end">
            Scoring, easy schedule
          </text>
          <text className="af-stb-quad" x={PAD.l + 4} y={PAD.t + 10}>
            Low scoring, tough schedule
          </text>
          <text className="af-stb-quad" x={PAD.l + 4} y={H - PAD.b - 6}>
            Low scoring, soft schedule
          </text>
          {[x0, (x0 + x1) / 2, x1].map((v) => (
            <text key={`x${v}`} className="af-stb-axis" x={sx(v)} y={H - PAD.b + 16} textAnchor="middle">
              {Math.round(v)}
            </text>
          ))}
          {[y0, (y0 + y1) / 2, y1].map((v) => (
            <text key={`y${v}`} className="af-stb-axis" x={PAD.l - 6} y={sy(v) + 3} textAnchor="end">
              {Math.round(v)}
            </text>
          ))}
          <text className="af-stb-axis" x={(PAD.l + W - PAD.r) / 2} y={H - 4} textAnchor="middle">
            Points for
          </text>
          {ordered.map((t) => (
            <g
              key={t.rosterId}
              className="af-stb-point"
              data-you={t.isYou ? 'true' : undefined}
              data-hover={t.rosterId === hover ? 'true' : undefined}
              tabIndex={0}
              aria-label={`${t.name}: ${pts(t.pointsFor)} for, ${pts(t.pointsAgainst!)} against`}
              onPointerEnter={() => setHover(t.rosterId)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(t.rosterId)}
              onBlur={() => setHover(null)}
            >
              <circle className="af-stb-point-hit" cx={sx(t.pointsFor)} cy={sy(t.pointsAgainst!)} r={12} />
              <circle className="af-stb-point-dot" cx={sx(t.pointsFor)} cy={sy(t.pointsAgainst!)} r={5} />
              {t.isYou ? (
                <text className="af-stb-point-label" x={sx(t.pointsFor) + 9} y={sy(t.pointsAgainst!) - 8}>
                  You
                </text>
              ) : null}
            </g>
          ))}
        </svg>
        {hovered ? (
          <div
            className="af-stb-tip"
            role="status"
            style={{ left: `${Math.min(70, Math.max(4, (sx(hovered.pointsFor) / W) * 100))}%` }}
          >
            <strong>{hovered.name}</strong>
            <span>
              <b className="af-num">{pts(hovered.pointsFor)}</b> for · <b className="af-num">{pts(hovered.pointsAgainst!)}</b> against
            </span>
            <span>{formatRecord(hovered.record)}</span>
          </div>
        ) : null}
      </div>
    </figure>
  )
}

function WinsVsExpected({ teams }: { teams: BoardTeam[] }) {
  const rows = teams
    .filter((t) => t.weeksPlayed > 0)
    .map((t) => ({ t, actual: t.headToHeadWins }))
    .sort((a, b) => b.t.luck - a.t.luck || a.t.seed - b.t.seed)
  if (rows.length < 2) return null
  const max = Math.max(1, ...rows.map((r) => Math.max(r.actual, r.t.expectedWins)))
  const ROW = 28
  const LABEL = 170
  const VALUE = 64
  const WIDE = 560
  const height = rows.length * ROW + 30
  const sx = (v: number) => LABEL + (v / max) * (WIDE - LABEL - VALUE)

  return (
    <figure className="af-stb-chart">
      <figcaption className="af-stb-chart-title">
        <b>Wins vs expected wins</b>
        <small>
          ● actual head-to-head wins · ○ wins its scoring earned against the whole league (all-play). A long line to the
          right is a kind schedule; to the left, a cruel one.
        </small>
      </figcaption>
      <div className="af-stb-chart-plot">
        <svg
          viewBox={`0 0 ${WIDE} ${height}`}
          role="img"
          aria-label={rows
            .map(
              ({ t, actual }) =>
                `${t.name}: ${actual} wins, ${t.expectedWins.toFixed(1)} expected, all-play ${formatRecord(t.allPlay)}`,
            )
            .join('; ')}
        >
          {Array.from({ length: Math.floor(max) + 1 }, (_, k) => (
            <g key={k}>
              <line className="af-stb-grid" x1={sx(k)} x2={sx(k)} y1={4} y2={height - 22} />
              <text className="af-stb-axis" x={sx(k)} y={height - 8} textAnchor="middle">
                {k}
              </text>
            </g>
          ))}
          {rows.map(({ t, actual }, i) => {
            const cy = 14 + i * ROW
            const a = sx(actual)
            const e = sx(t.expectedWins)
            return (
              <g key={t.rosterId} className="af-stb-dumbbell" data-you={t.isYou ? 'true' : undefined}>
                <title>{`${t.name}: ${actual} wins vs ${t.expectedWins.toFixed(2)} expected (all-play ${formatRecord(t.allPlay)})`}</title>
                <text className="af-stb-rowlabel" x={LABEL - 10} y={cy + 4} textAnchor="end">
                  {t.name.length > 20 ? `${t.name.slice(0, 19)}…` : t.name}
                </text>
                <line className="af-stb-dumbbell-bar" x1={Math.min(a, e)} x2={Math.max(a, e)} y1={cy} y2={cy} />
                <circle className="af-stb-dumbbell-exp" cx={e} cy={cy} r={4.5} />
                <circle className="af-stb-dumbbell-act" cx={a} cy={cy} r={4.5} />
                <text className="af-stb-rowvalue" x={WIDE - 4} y={cy + 4} textAnchor="end">
                  {t.luck > 0 ? '+' : t.luck < 0 ? '−' : ''}
                  {Math.abs(t.luck).toFixed(1)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </figure>
  )
}

function PointsBars({ teams }: { teams: BoardTeam[] }) {
  const rows = [...teams].filter((t) => t.weeksPlayed > 0).sort((a, b) => b.pointsFor - a.pointsFor)
  if (rows.length === 0) return null
  const max = Math.max(1, ...rows.map((t) => t.pointsFor))
  return (
    <figure className="af-stb-chart">
      <figcaption className="af-stb-chart-title">
        <b>Points for</b>
        <small>This league has no head-to-head games, so points are the whole story.</small>
      </figcaption>
      <ul className="af-stb-bars">
        {rows.map((t) => (
          <li key={t.rosterId} data-you={t.isYou ? 'true' : undefined}>
            <span>{t.name}</span>
            <span className="af-stb-bar">
              <i style={{ width: `${((t.pointsFor / max) * 100).toFixed(1)}%` }} />
            </span>
            <span className="af-num">{pts(t.pointsFor)}</span>
          </li>
        ))}
      </ul>
    </figure>
  )
}

export function StandingsPointsChart({ board, teams }: { board: StandingsBoard; teams: BoardTeam[] }) {
  if (!board.hasHeadToHead) return <PointsBars teams={teams} />
  return (
    <div className="af-stb-charts">
      <PointsScatter teams={teams} />
      <WinsVsExpected teams={teams} />
    </div>
  )
}
