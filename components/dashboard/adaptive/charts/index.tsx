'use client'

/**
 * Adaptive dashboard chart kit.
 *
 * Ten shared, reusable chart primitives — the design handoff's explicit ask, so that League
 * Home / My Team / Players / Commissioner HQ reuse these instead of hand-rolling one-off SVG
 * per screen. Each is presentational only: it takes already-computed numbers and renders
 * them. Nothing here fetches, derives, or invents a value.
 *
 * Every chart accepts `data === null | []` and renders nothing in that case — the CALLER is
 * responsible for showing `<NoMetric/>` instead. That split matters: a chart that silently
 * draws a zeroed axis when handed no data is indistinguishable from one reporting a real
 * zero, which is exactly the fabrication class this repo has had to fix before.
 *
 * Colours come from the scoped `.af-adaptive` token set in `../adaptive-dashboard.css`; the
 * `color` props take a CSS colour string so callers can pass `var(--af-emerald)` etc.
 */

import { useId } from 'react'
import {
  areaPath, columnHeights, poly, radarAxes, radarPoints, ring, scaleLinear,
} from './chart-geometry'

// ── Gauge — partial-sweep arc with the value in the middle ─────────────────────
export function GaugeChart({
  value, max = 100, display, color, size = 58, sweep = 0.75, strokeWidth = 9,
}: {
  value: number
  max?: number
  /** Text in the centre. Defaults to the rounded value. */
  display?: string
  color: string
  size?: number
  /** Fraction of the circle the gauge spans — .75 = 270°. */
  sweep?: number
  strokeWidth?: number
}) {
  const pct = max > 0 ? (value / max) * 100 : 0
  const { track, fg } = ring(40, pct, sweep)
  // A 270° gauge is centred by rotating its start point back by half the missing arc.
  const rotation = 90 + (360 * (1 - sweep)) / 2
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`${display ?? Math.round(value)} of ${max}`}>
      <circle cx="50" cy="50" r="40" fill="none" stroke="var(--af-surface-2)" strokeWidth={strokeWidth}
        strokeDasharray={track} strokeLinecap="round" transform={`rotate(${rotation} 50 50)`} />
      <circle cx="50" cy="50" r="40" fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeDasharray={fg} strokeLinecap="round" transform={`rotate(${rotation} 50 50)`} />
      <text x="50" y="57" textAnchor="middle" fontFamily="var(--af-font-display)" fontSize="26" fill="#fff">
        {display ?? Math.round(value)}
      </text>
    </svg>
  )
}

// ── Sparkline — bare trend line, no axes ───────────────────────────────────────
export function SparklineChart({
  values, color, height = 28, width = 96,
}: { values: number[]; color: string; height?: number; width?: number }) {
  if (values.length < 2) return null
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} 30`} preserveAspectRatio="none" role="img" aria-hidden="true">
      <polyline points={poly(values, width, 30, 3)} fill="none" stroke={color} strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ── Donut — closed ring with a centred value ───────────────────────────────────
export function DonutChart({
  value, max = 100, display, color, size = 58, strokeWidth = 9,
}: { value: number; max?: number; display?: string; color: string; size?: number; strokeWidth?: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  const { fg } = ring(40, pct, 1)
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={display ?? `${Math.round(pct)}%`}>
      <circle cx="50" cy="50" r="40" fill="none" stroke="var(--af-surface-2)" strokeWidth={strokeWidth} />
      <circle cx="50" cy="50" r="40" fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeDasharray={fg} strokeLinecap="round" transform="rotate(-90 50 50)" />
      <text x="50" y="57" textAnchor="middle" fontFamily="var(--af-font-display)" fontSize="22" fill="#fff">
        {display ?? `${Math.round(pct)}%`}
      </text>
    </svg>
  )
}

// ── Columns — compact bar series (7-day activity etc.) ─────────────────────────
export function ColumnChart({
  points, color, height = 32,
}: {
  /** One bar per entry. `label` is the hover title (e.g. the weekday). */
  points: Array<{ label: string; value: number }>
  color: string
  height?: number
}) {
  if (points.length === 0) return null
  const heights = columnHeights(points.map((p) => p.value), height - 4)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height }}>
      {points.map((p, i) => (
        <div key={`${p.label}-${i}`} title={`${p.label}: ${p.value}`}
          style={{ flex: 1, height: heights[i], background: color, borderRadius: 2, opacity: 0.85 }} />
      ))}
    </div>
  )
}

// ── Line + area — a primary series, an optional comparison, gradient fill ──────
export function LineAreaChart({
  series, comparison, color = 'var(--af-violet)', height = 108, labels,
}: {
  series: number[]
  /** Dashed reference line (e.g. league average). Omitted when there's no real comparison. */
  comparison?: number[] | null
  color?: string
  height?: number
  /** X-axis tick labels rendered under the plot. */
  labels?: string[]
}) {
  const gradientId = useId()
  if (series.length < 2) return null
  const W = 300
  const H = height
  const PAD = 6
  // Both series must share one y-domain or the comparison line is meaningless. Scale them
  // together by padding the shorter one out of the domain calc, then plotting on the union.
  const domain = comparison && comparison.length > 1 ? [...series, ...comparison] : series
  const min = Math.min(...domain)
  const max = Math.max(...domain)
  const project = (vals: number[]) =>
    poly(vals.map((v) => scaleLinear(v, min, max, 0, 100)), W, H, PAD)

  return (
    <>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath(series.map((v) => scaleLinear(v, min, max, 0, 100)), W, H, PAD)}
          fill={`url(#${gradientId})`} opacity="0.18" />
        {comparison && comparison.length > 1 && (
          <polyline points={project(comparison)} fill="none" stroke="rgba(255,255,255,.3)"
            strokeWidth="1.5" strokeDasharray="3 3" />
        )}
        <polyline points={project(series)} fill="none" stroke={color} strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {labels && labels.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: 'var(--af-text-faint)', marginTop: 2 }}>
          {labels.map((l, i) => <span key={`${l}-${i}`}>{l}</span>)}
        </div>
      )}
    </>
  )
}

// ── Horizontal bars — position strength, category comparison ──────────────────
export function HorizontalBarChart({
  rows, max = 100, showValue = true,
}: {
  rows: Array<{ key: string; value: number; color: string }>
  max?: number
  showValue?: boolean
}) {
  if (rows.length === 0) return null
  return (
    <>
      {rows.map((r) => (
        <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
          <div style={{ width: 26, fontSize: 11, fontWeight: 700, color: 'var(--af-text-muted)' }}>{r.key}</div>
          <div style={{ flex: 1, height: 8, background: 'var(--af-surface-2)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              width: `${Math.max(0, Math.min(100, (r.value / max) * 100))}%`,
              height: '100%', background: r.color, borderRadius: 4,
            }} />
          </div>
          {showValue && (
            <div style={{ width: 22, fontSize: 10.5, color: 'var(--af-text-muted)', textAlign: 'right' }}>
              {Math.round(r.value)}
            </div>
          )}
        </div>
      ))}
    </>
  )
}

// ── Radar — multi-axis shape vs an optional baseline ──────────────────────────
export function RadarChart({
  categories, values, comparison, max = 100, color = 'var(--af-violet)', size = 184,
}: {
  categories: string[]
  values: number[]
  /** Dashed baseline polygon (e.g. league average). Omitted when there's no real baseline. */
  comparison?: number[] | null
  max?: number
  color?: string
  size?: number
}) {
  if (categories.length < 3 || values.length !== categories.length) return null
  const cx = size / 2
  const cy = size / 2 - 2
  const r = size * 0.33
  const axes = radarAxes(categories, cx, cy, r)
  return (
    <svg width={size} height={size - 4} viewBox={`0 0 ${size} ${size - 4}`} role="img" aria-hidden="true">
      {axes.map((ax) => (
        <line key={`ax-${ax.label}`} x1={ax.x1} y1={ax.y1} x2={ax.x2} y2={ax.y2}
          stroke="var(--af-border)" strokeWidth="1" />
      ))}
      {comparison && comparison.length === categories.length && (
        <polygon points={radarPoints(comparison, max, cx, cy, r)} fill="none"
          stroke="rgba(255,255,255,.25)" strokeWidth="1.5" strokeDasharray="3 3" />
      )}
      <polygon points={radarPoints(values, max, cx, cy, r)} fill={color} fillOpacity="0.25"
        stroke={color} strokeWidth="2" />
      {axes.map((ax) => (
        <text key={`lb-${ax.label}`} x={ax.lx} y={ax.ly} textAnchor="middle" fontSize="10.5"
          fill="var(--af-text-muted)" fontFamily="var(--af-font-ui)" dominantBaseline="middle">
          {ax.label}
        </text>
      ))}
    </svg>
  )
}

// ── Scatter / bubble — two continuous axes, magnitude as radius ───────────────
export function ScatterBubbleChart({
  points, color = 'var(--af-cyan)', height = 130, xDomain = [0, 100], yDomain = [0, 100], axisLabels,
}: {
  points: Array<{ x: number; y: number; weight: number; label?: string }>
  color?: string
  height?: number
  xDomain?: [number, number]
  yDomain?: [number, number]
  axisLabels?: [string, string]
}) {
  if (points.length === 0) return null
  const W = 300
  const H = height
  const PAD = 20
  return (
    <>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-hidden="true">
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="var(--af-border)" />
        <line x1={PAD} y1={H - PAD} x2={W - 10} y2={H - PAD} stroke="var(--af-border)" />
        {points.map((p, i) => (
          <circle key={`${p.label ?? 'pt'}-${i}`}
            cx={scaleLinear(p.x, xDomain[0], xDomain[1], PAD, W - PAD).toFixed(1)}
            cy={scaleLinear(p.y, yDomain[0], yDomain[1], H - PAD, PAD).toFixed(1)}
            r={4 + Math.max(0, p.weight) * 2}
            fill={color} fillOpacity="0.55" stroke={color} strokeWidth="1.5">
            {p.label && <title>{p.label}</title>}
          </circle>
        ))}
      </svg>
      {axisLabels && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: 'var(--af-text-faint)' }}>
          <span>{axisLabels[0]}</span><span>{axisLabels[1]}</span>
        </div>
      )}
    </>
  )
}

// ── Multi-ring — concentric gauges sharing a centre value ─────────────────────
export function MultiRingChart({
  rings, centerValue, size = 88,
}: {
  /** Outermost first. Each is an independent 0–100 metric. */
  rings: Array<{ label: string; value: number; color: string }>
  centerValue?: string
  size?: number
}) {
  if (rings.length === 0) return null
  const radii = [42, 33, 24, 15]
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img"
      aria-label={rings.map((r) => `${r.label} ${Math.round(r.value)}`).join(', ')}>
      {rings.slice(0, radii.length).map((r, i) => (
        <g key={r.label}>
          <circle cx="50" cy="50" r={radii[i]} fill="none" stroke="var(--af-surface-2)" strokeWidth="7" />
          <circle cx="50" cy="50" r={radii[i]} fill="none" stroke={r.color} strokeWidth="7"
            strokeDasharray={ring(radii[i], r.value, 1).fg} strokeLinecap="round"
            transform="rotate(-90 50 50)" />
        </g>
      ))}
      {centerValue && (
        <text x="50" y="56" textAnchor="middle" fontFamily="var(--af-font-display)" fontSize="24" fill="#fff">
          {centerValue}
        </text>
      )}
    </svg>
  )
}

// ── Linear progress — XP bars, sync progress, any 0–100 fill ──────────────────
export function LinearProgressChart({
  value, max = 100, height = 5, color = 'linear-gradient(90deg,var(--af-cyan),var(--af-blue))', track = 'var(--af-surface-2)',
}: { value: number; max?: number; height?: number; color?: string; track?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div style={{ height, background: track, borderRadius: height / 2 + 0.5, overflow: 'hidden' }}
      role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${pct}%`, height: '100%', background: color }} />
    </div>
  )
}

export * from './chart-geometry'
