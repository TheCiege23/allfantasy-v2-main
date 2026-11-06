'use client'

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { OddsHistoryPoint } from '@/lib/core-app/seasonOutlookOddsHistory'
import { pct } from '@/lib/core-app/outlookCopy'
import { useMessages } from '@/components/i18n/useMessages'
import { seasonOutlookLeagueMessages } from '@/lib/core-app/messages/seasonOutlookLeague'

/**
 * Season Outlook — your playoff % and title % by week this season (`league_odds_snapshots`).
 *
 * Two series on ONE 0–100% axis, in a fixed order: playoffs in `--chart-1`, title in `--chart-2` (the
 * tokens validated for the Commissioner Hub charts; re-run through the dataviz validator for this pair on
 * #0d1020, #170f2b and #ffffff — all checks pass, worst CVD ΔE 24.7). Identity is never colour alone: a
 * legend, a direct label at each line's end, and a different marker per series (circle / square). Text
 * stays in text tokens; the colour sits on the marks.
 *
 * The crosshair snaps to the nearest week on hover; the same readout follows keyboard focus (arrow keys,
 * Home, End). Every value is also in the "Show the numbers" table, so the tooltip never gates anything.
 *
 * Draws nothing below two weeks — the loader already returns null there, and this guards it again so a
 * caller can never put an empty box on the screen.
 */

const HEIGHT = 200
const PAD = { left: 40, right: 104, top: 12, bottom: 28 }
const TICKS = [0, 25, 50, 75, 100]
const LABEL_GAP = 16

type Series = { key: 'playoff' | 'title'; value: (p: OddsHistoryPoint) => number; color: string; marker: 'circle' | 'square' }

const SERIES: Series[] = [
  { key: 'playoff', value: (p) => p.playoffPct, color: 'var(--chart-1)', marker: 'circle' },
  { key: 'title', value: (p) => p.titlePct, color: 'var(--chart-2)', marker: 'square' },
]

const clampPct = (n: number) => Math.max(0, Math.min(100, n))

function Marker({ shape, x, y, color, size = 8 }: { shape: Series['marker']; x: number; y: number; color: string; size?: number }) {
  return shape === 'circle' ? (
    <circle cx={x} cy={y} r={size / 2} fill={color} stroke="var(--surface)" strokeWidth={2} />
  ) : (
    <rect x={x - size / 2} y={y - size / 2} width={size} height={size} rx={1.5} fill={color} stroke="var(--surface)" strokeWidth={2} />
  )
}

/** Spread two end labels apart when their lines finish close together. */
function spreadLabels(ys: number[], top: number, bottom: number): number[] {
  if (ys.length !== 2 || Math.abs(ys[0] - ys[1]) >= LABEL_GAP) return ys
  const mid = (ys[0] + ys[1]) / 2
  const upperFirst = ys[0] <= ys[1]
  let a = mid - LABEL_GAP / 2
  let b = mid + LABEL_GAP / 2
  if (a < top) { b += top - a; a = top }
  if (b > bottom) { a -= b - bottom; b = bottom }
  return upperFirst ? [a, b] : [b, a]
}

export function OddsHistoryChart({ points }: { points: OddsHistoryPoint[] | null | undefined }) {
  const m = useMessages(seasonOutlookLeagueMessages)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(640)
  const [active, setActive] = useState<number | null>(null)

  /* Draw at the real pixel width, so 11px type stays 11px on a phone instead of scaling down with a viewBox. */
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => {
      const w = Math.round(el.getBoundingClientRect().width)
      if (w > 0) setWidth(w)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const data = (points ?? []).slice().sort((a, b) => a.week - b.week)
  if (data.length < 2) return null

  const labels = { playoff: m.playoffsLabel, title: m.title }
  const first = data[0].week
  const last = data[data.length - 1].week
  const x0 = PAD.left
  const x1 = Math.max(x0 + 40, width - PAD.right)
  const y0 = PAD.top
  const yBase = HEIGHT - PAD.bottom
  const x = (week: number) => (last === first ? (x0 + x1) / 2 : x0 + ((week - first) / (last - first)) * (x1 - x0))
  const y = (v: number) => yBase - (clampPct(v) / 100) * (yBase - y0)

  const path = (s: Series) => data.map((p, i) => `${i ? 'L' : 'M'}${x(p.week).toFixed(1)},${y(s.value(p)).toFixed(1)}`).join(' ')
  const end = data[data.length - 1]
  const labelYs = spreadLabels(SERIES.map((s) => y(s.value(end))), y0 + 6, yBase - 2)

  /* Thin the x labels on a narrow chart, always keeping the first and last week. */
  const room = Math.max(1, Math.floor((x1 - x0) / 34))
  const stride = Math.max(1, Math.ceil(data.length / room))
  const showX = (i: number) => i === 0 || i === data.length - 1 || (i % stride === 0 && data.length - 1 - i >= stride / 2)

  const nearest = (px: number) => {
    let best = 0
    for (let i = 1; i < data.length; i++) if (Math.abs(x(data[i].week) - px) < Math.abs(x(data[best].week) - px)) best = i
    return best
  }
  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const box = (e.currentTarget.ownerSVGElement ?? e.currentTarget).getBoundingClientRect()
    setActive(nearest(e.clientX - box.left))
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const lastIndex = data.length - 1
    const cur = active ?? lastIndex
    const next =
      e.key === 'ArrowRight' ? Math.min(lastIndex, cur + 1)
      : e.key === 'ArrowLeft' ? Math.max(0, cur - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? lastIndex
      : null
    if (next == null) return
    e.preventDefault()
    setActive(next)
  }

  const hovered = active != null ? data[active] : null
  const tipX = hovered ? x(hovered.week) : 0
  const tipAlign = tipX > width - 120 ? 'end' : tipX < 90 ? 'start' : 'center'

  return (
    <section className="af-olk-hist" data-testid="outlook-odds-history" aria-labelledby="so-odds-history">
      <header className="af-olk-hist-head">
        <h3 id="so-odds-history" className="af-olk-hist-title">{m.historyTitle}</h3>
        <ul className="af-olk-hist-legend" aria-label={m.historyTitle}>
          {SERIES.map((s) => (
            <li key={s.key} data-testid={`outlook-odds-history-legend-${s.key}`}>
              <svg width="22" height="10" aria-hidden focusable="false">
                <line x1="1" x2="21" y1="5" y2="5" stroke={s.color} strokeWidth="2" strokeLinecap="round" />
                <Marker shape={s.marker} x={11} y={5} color={s.color} size={7} />
              </svg>
              {labels[s.key]}
            </li>
          ))}
        </ul>
      </header>

      <div
        ref={wrapRef}
        className="af-olk-hist-plot"
        tabIndex={0}
        role="group"
        aria-label={m.historyAria(first, last)}
        onKeyDown={onKey}
        onFocus={() => setActive((a) => a ?? data.length - 1)}
        onBlur={() => setActive(null)}
      >
        <svg width={width} height={HEIGHT} aria-hidden focusable="false" className="af-olk-hist-svg">
          {TICKS.map((t) => (
            <g key={t}>
              <line x1={x0} x2={x1} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--line2)' : 'var(--line)'} strokeWidth={1} />
              <text x={x0 - 8} y={y(t) + 4} textAnchor="end" className="af-olk-hist-tick">{t}%</text>
            </g>
          ))}
          {data.map((p, i) =>
            showX(i) ? (
              <text key={`x${p.week}`} x={x(p.week)} y={HEIGHT - 8} textAnchor="middle" className="af-olk-hist-tick">
                {m.historyWeekShort(p.week)}
              </text>
            ) : null,
          )}
          {hovered ? <line x1={tipX} x2={tipX} y1={y0} y2={yBase} stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 3" /> : null}
          {SERIES.map((s) => (
            <g key={s.key} data-testid={`outlook-odds-history-series-${s.key}`}>
              <path d={path(s)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {data.map((p, i) => (
                <Marker key={p.week} shape={s.marker} x={x(p.week)} y={y(s.value(p))} color={s.color} size={i === active ? 11 : 8} />
              ))}
            </g>
          ))}
          {SERIES.map((s, i) => (
            <g key={`end-${s.key}`} data-testid={`outlook-odds-history-label-${s.key}`}>
              <Marker shape={s.marker} x={x1 + 12} y={labelYs[i]} color={s.color} size={7} />
              <text x={x1 + 20} y={labelYs[i] + 4} className="af-olk-hist-end">
                <tspan className="af-olk-hist-end-v">{pct(s.value(end))}%</tspan> {labels[s.key]}
              </text>
            </g>
          ))}
          <rect
            x={x0 - 12}
            y={0}
            width={x1 - x0 + 24}
            height={HEIGHT}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setActive(null)}
          />
        </svg>
        {hovered ? (
          <div
            className="af-olk-hist-tip"
            data-align={tipAlign}
            style={{ left: tipX }}
            role="status"
            aria-live="polite"
            data-testid="outlook-odds-history-tip"
          >
            <span className="af-olk-hist-tip-w">{m.historyWeek(hovered.week)}</span>
            {SERIES.map((s) => (
              <span key={s.key} className="af-olk-hist-tip-row">
                <i style={{ background: s.color }} aria-hidden />
                <b>{pct(s.value(hovered))}%</b> {labels[s.key]}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <p className="af-olk-hist-note">{m.historyNote}</p>
      <details className="af-olk-hist-data">
        <summary>{m.historyTable}</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">{m.week}</th>
              <th scope="col">{labels.playoff}</th>
              <th scope="col">{labels.title}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.week}>
                <th scope="row">{m.historyWeek(p.week)}</th>
                <td>{pct(p.playoffPct)}%</td>
                <td>{pct(p.titlePct)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  )
}
