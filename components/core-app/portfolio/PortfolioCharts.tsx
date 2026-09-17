'use client'

import { useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react'

/**
 * The portfolio's chart primitives — inline SVG and plain HTML on the `/core` tokens, the same way
 * `Career.tsx` draws its arc. No chart library: every mark here is a handful of elements, and a
 * library would ship its own colours and tooltips that disagree with the rest of the shell.
 *
 * Rules these follow (the dataviz method, applied):
 *   - ONE hue per chart unless the series ARE the subject. Bars and lines are `--accent`; the risk
 *     grid is an ordinal ramp validated per theme (see af-portfolio.css).
 *   - A number beside every coloured mark, never colour alone.
 *   - Hover AND keyboard focus show the same tooltip, and every value in a tooltip is also in the
 *     list printed under the chart — the tooltip enhances, it never gates.
 *   - Wide charts scroll sideways inside their own box on a phone; the page never does.
 */

export function ChartScroll({ children, minWidth, label }: { children: ReactNode; minWidth: number; label: string }) {
  return (
    <div className="af-pfc-scroll" role="region" aria-label={label} tabIndex={0}>
      <div className="af-pfc-scroll-inner" style={{ minWidth }}>
        {children}
      </div>
    </div>
  )
}

export function Legend({ items }: { items: Array<{ key: string; label: string; swatch: ReactNode }> }) {
  return (
    <ul className="af-pfc-legend">
      {items.map((i) => (
        <li key={i.key}>
          {i.swatch}
          <span>{i.label}</span>
        </li>
      ))}
    </ul>
  )
}

export function LineKey({ dashed = false }: { dashed?: boolean }) {
  return (
    <svg width="18" height="8" aria-hidden="true" className="af-pfc-linekey">
      <line x1="1" x2="17" y1="4" y2="4" strokeWidth="2" strokeLinecap="round" strokeDasharray={dashed ? '4 3' : undefined} />
    </svg>
  )
}

export function LevelSwatch({ level }: { level: 0 | 1 | 2 | 3 }) {
  return <span className="af-pfc-swatch" data-level={level} aria-hidden="true" />
}

// ── bar list ────────────────────────────────────────────────────────────────────────────────

export type BarItem = { key: string; label: string; value: number; hint?: string }

/**
 * Horizontal bars, one hue, the count printed at the tip. Each bar is a button — the whole row is
 * the hit target, not the painted bar — and pressing it hands the key back for a drill-down.
 */
export function BarList({
  items,
  max,
  selected,
  onSelect,
  unit,
  ariaLabel,
}: {
  items: BarItem[]
  /** Scale ceiling; defaults to the largest value, so bars compare within this list. */
  max?: number
  selected?: string | null
  onSelect?: (key: string) => void
  unit: (n: number) => string
  ariaLabel: string
}) {
  const top = Math.max(1, max ?? Math.max(0, ...items.map((i) => i.value)))
  return (
    <ul className="af-pfc-bars" aria-label={ariaLabel}>
      {items.map((item) => {
        const pct = Math.max(0, Math.min(100, (item.value / top) * 100))
        const body = (
          <>
            <span className="af-pfc-bar-label">
              <span className="af-pfc-bar-name">{item.label}</span>
              {item.hint ? <span className="af-pfc-bar-hint">{item.hint}</span> : null}
            </span>
            <span className="af-pfc-bar-track" aria-hidden="true">
              <span className="af-pfc-bar-fill" style={{ width: `${pct}%` }} />
            </span>
            <span className="af-pfc-bar-value af-num">{unit(item.value)}</span>
          </>
        )
        return (
          <li key={item.key}>
            {onSelect ? (
              <button
                type="button"
                className="af-pfc-bar"
                aria-pressed={selected === item.key}
                onClick={() => onSelect(item.key)}
              >
                {body}
              </button>
            ) : (
              <div className="af-pfc-bar">{body}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ── sparkline ───────────────────────────────────────────────────────────────────────────────

export function Sparkline({ values, label }: { values: Array<number | null>; label: string }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null)
  if (pts.length < 2) return <span className="af-pfc-spark-empty">—</span>
  const W = 72
  const H = 20
  const min = Math.min(...pts.map((p) => p.v))
  const max = Math.max(...pts.map((p) => p.v))
  const span = max - min || 1
  const x = (i: number) => (values.length <= 1 ? 0 : (i / (values.length - 1)) * (W - 4) + 2)
  const y = (v: number) => H - 3 - ((v - min) / span) * (H - 6)
  const d = pts.map((p, n) => `${n === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const last = pts[pts.length - 1]
  const dir = last.v > pts[0].v ? 'up' : last.v < pts[0].v ? 'down' : 'flat'
  return (
    <svg className="af-pfc-spark" data-dir={dir} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <path d={d} fill="none" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r="2.5" />
    </svg>
  )
}

// ── line chart ──────────────────────────────────────────────────────────────────────────────

export type LinePoint = { key: string; label: string; value: number | null; estimated: boolean; note?: string }

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
export const formatCompact = (n: number) => compact.format(n)

/**
 * A value a reader compares with its neighbours — three significant figures, so 2.05M does not
 * round to "2M" beside a tick reading "2.06M".
 */
const precise = new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 3 })
export const formatValue = (n: number) => precise.format(n)

/**
 * An axis tick, with as many decimals as the STEP needs.
 *
 * ⚠ `formatCompact` ALONE PRINTED "2.1M" ON FOUR TICKS IN A ROW. A portfolio worth ~2.1M moves in
 * steps of ~25K, which one decimal of millions cannot tell apart — the axis read as flat while the
 * line moved. The unit is picked from the largest tick, the decimals from the step within it.
 */
export function formatTick(value: number, step: number, max: number): string {
  const abs = Math.abs(max)
  const [unit, suffix] = abs >= 1e6 ? [1e6, 'M'] : abs >= 1e3 ? [1e3, 'K'] : [1, '']
  const scaledStep = step / unit
  const decimals = scaledStep >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(scaledStep) - 1e-9))
  return `${(value / unit).toFixed(decimals)}${suffix}`
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * 0.05)
    min -= pad
    max += pad
  }
  const raw = (max - min) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const start = Math.floor(min / step) * step
  const out: number[] = []
  for (let v = start; v <= max + step * 0.5; v += step) out.push(Math.round(v * 1000) / 1000)
  return out
}

/**
 * One series over time. A point is `estimated` when it is today's roster priced at that day's
 * market, and the stretch into it is drawn dashed; a recorded day is solid. The crosshair snaps to
 * the nearest day; arrow keys walk the days when the chart has focus.
 */
export function LineChart({
  points,
  ariaLabel,
  valueLabel,
  selected = null,
  onSelect,
}: {
  points: LinePoint[]
  ariaLabel: string
  valueLabel: (n: number) => string
  /** The pinned day's key — its breakdown is listed under the chart by the caller. */
  selected?: string | null
  /** Click, or Enter while focused, pins the day under the crosshair. */
  onSelect?: (key: string) => void
}) {
  const W = 640
  const H = 220
  const L = 52
  const R = 16
  const T = 14
  const B = 30
  const svgRef = useRef<SVGSVGElement>(null)
  const pointerFocus = useRef(false)
  const [hover, setHover] = useState<number | null>(null)
  const tipId = useId()

  const priced = points.filter((p) => p.value != null) as Array<LinePoint & { value: number }>
  const ticks = useMemo(
    () => niceTicks(Math.min(...priced.map((p) => p.value)), Math.max(...priced.map((p) => p.value))),
    [priced],
  )
  if (priced.length === 0) return <p className="af-pfc-empty">No priced days in this window yet.</p>

  const lo = ticks[0] ?? 0
  const hi = ticks[ticks.length - 1] ?? 1
  const x = (i: number) => (points.length <= 1 ? (L + W - R) / 2 : L + (i / (points.length - 1)) * (W - L - R))
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B)

  /* Segments between consecutive priced points; dashed when either end is an estimate. */
  const segments: Array<{ d: string; estimated: boolean }> = []
  let prev: { i: number; p: LinePoint & { value: number } } | null = null
  points.forEach((p, i) => {
    if (p.value == null) {
      prev = null
      return
    }
    const cur = { i, p: p as LinePoint & { value: number } }
    if (prev) {
      segments.push({
        d: `M${x(prev.i).toFixed(1)},${y(prev.p.value).toFixed(1)} L${x(i).toFixed(1)},${y(p.value).toFixed(1)}`,
        estimated: prev.p.estimated || p.estimated,
      })
    }
    prev = cur
  })

  const lastIndex = points.reduce((acc, p, i) => (p.value != null ? i : acc), -1)
  const labelEvery = Math.max(1, Math.ceil(points.length / 6))

  function nearestIndex(clientX: number): number | null {
    const svg = svgRef.current
    if (!svg) return null
    const box = svg.getBoundingClientRect()
    const sx = ((clientX - box.left) / box.width) * W
    let best: number | null = null
    let bestD = Infinity
    points.forEach((p, i) => {
      if (p.value == null) return
      const d = Math.abs(x(i) - sx)
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    return best
  }

  function nearest(clientX: number) {
    const i = nearestIndex(clientX)
    if (i != null) setHover(i)
  }

  function onKey(e: KeyboardEvent<SVGSVGElement>) {
    if ((e.key === 'Enter' || e.key === ' ') && onSelect && hover != null) {
      e.preventDefault()
      onSelect(points[hover].key)
      return
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const pricedIdx = points.map((p, i) => (p.value != null ? i : -1)).filter((i) => i >= 0)
    const at = hover == null ? pricedIdx.length - 1 : pricedIdx.indexOf(hover)
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? pricedIdx.length - 1 : e.key === 'ArrowLeft' ? Math.max(0, at - 1) : Math.min(pricedIdx.length - 1, at + 1)
    setHover(pricedIdx[next] ?? null)
  }

  const hp = hover != null ? points[hover] : null
  const tipLeftPct = hover != null ? (x(hover) / W) * 100 : 0

  return (
    <div className="af-pfc-line">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={ariaLabel}
        aria-describedby={hp ? tipId : undefined}
        tabIndex={0}
        onPointerMove={(e: PointerEvent<SVGSVGElement>) => nearest(e.clientX)}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => {
          if (!onSelect) return
          const i = nearestIndex(e.clientX)
          if (i != null) onSelect(points[i].key)
        }}
        style={onSelect ? { cursor: 'pointer' } : undefined}
        onPointerDown={() => {
          pointerFocus.current = true
        }}
        onFocus={() => {
          /*
           * Keyboard focus only. A mouse click also focuses the chart, and jumping the crosshair to
           * the last day then put the tooltip for one day beside the marker of another.
           */
          const fromPointer = pointerFocus.current
          pointerFocus.current = false
          if (!fromPointer && hover == null) setHover(lastIndex >= 0 ? lastIndex : null)
        }}
        onBlur={() => setHover(null)}
        onKeyDown={onKey}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line className="af-pfc-grid" x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
            <text className="af-pfc-tick" x={L - 8} y={y(t) + 3} textAnchor="end">
              {formatTick(t, ticks.length > 1 ? ticks[1] - ticks[0] : Math.abs(t) || 1, hi)}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text key={p.key} className="af-pfc-tick" x={x(i)} y={H - 10} textAnchor="middle">
              {p.label}
            </text>
          ) : null,
        )}
        {segments.map((s, i) => (
          <path key={i} className="af-pfc-series" data-estimated={s.estimated || undefined} d={s.d} />
        ))}
        {hover != null && hp?.value != null ? (
          <>
            <line className="af-pfc-cross" x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} />
            <circle className="af-pfc-dot" cx={x(hover)} cy={y(hp.value)} r="4.5" />
          </>
        ) : null}
        {(() => {
          const si = selected != null ? points.findIndex((p) => p.key === selected) : -1
          const sp = si >= 0 ? points[si] : null
          return sp && sp.value != null ? (
            <g className="af-pfc-pin">
              <line className="af-pfc-cross" x1={x(si)} x2={x(si)} y1={T} y2={H - B} />
              <circle className="af-pfc-dot" cx={x(si)} cy={y(sp.value)} r="5.5" />
            </g>
          ) : null
        })()}
        {lastIndex >= 0 && hover == null && selected == null ? (
          <circle className="af-pfc-dot" cx={x(lastIndex)} cy={y(points[lastIndex].value as number)} r="4.5" />
        ) : null}
      </svg>
      {hp && hp.value != null ? (
        <div
          id={tipId}
          className="af-pfc-tip"
          role="status"
          style={{ left: `${Math.min(82, Math.max(18, tipLeftPct))}%` }}
        >
          <strong className="af-num">{valueLabel(hp.value)}</strong>
          <span>
            <LineKey dashed={hp.estimated} /> {hp.label} · {hp.estimated ? 'estimated' : 'recorded'}
          </span>
          {hp.note ? <span className="af-pfc-tip-note">{hp.note}</span> : null}
        </div>
      ) : null}
    </div>
  )
}

// ── heatmap ─────────────────────────────────────────────────────────────────────────────────

export type HeatCell = { level: 0 | 1 | 2 | 3; count: number; unknown?: string }

/**
 * Rows × columns, each cell a button carrying its count. A semantic table so a screen reader walks
 * it as one; the row header is the league, the column header the risk.
 */
export function Heatmap({
  columns,
  rows,
  selected,
  onSelect,
  caption,
}: {
  columns: Array<{ id: string; label: string }>
  rows: Array<{ key: string; label: ReactNode; cells: HeatCell[] }>
  selected: { row: string; column: string } | null
  onSelect: (row: string, column: string) => void
  caption: string
}) {
  return (
    <table className="af-pfc-heat">
      <caption className="af-sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col" className="af-pfc-heat-corner">
            League
          </th>
          {columns.map((c) => (
            <th key={c.id} scope="col">
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <th scope="row">{r.label}</th>
            {r.cells.map((cell, ci) => {
              const col = columns[ci]
              const isSel = selected?.row === r.key && selected.column === col.id
              if (cell.unknown) {
                return (
                  <td key={col.id}>
                    <span className="af-pfc-cell" data-unknown="true" title={cell.unknown}>
                      –
                    </span>
                  </td>
                )
              }
              return (
                <td key={col.id}>
                  <button
                    type="button"
                    className="af-pfc-cell"
                    data-level={cell.level}
                    aria-pressed={isSel}
                    aria-label={`${col.label}: ${cell.count}`}
                    disabled={cell.count === 0}
                    onClick={() => onSelect(r.key, col.id)}
                  >
                    {cell.count}
                  </button>
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
