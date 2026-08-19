/**
 * Fantasy OS Phase 4 — executive chart kit (Part 6/8).
 *
 * Lightweight, dependency-free SVG charts following this codebase's proven convention (see
 * components/executive-viz/ExecutiveCharts.tsx): draw with `currentColor` driven by SOLID semantic text
 * tokens per series, so light/dark + white-label re-theme are honored and the `status-*` opacity gotcha is
 * avoided. Each chart is deterministic, accessible (title/desc), and pairs with the ExecutiveChartCard chrome.
 */
import type { ReactNode } from 'react'
import type { YearlySeries, StackedYearlyPoint, Distribution } from '@/lib/fantasy-os/exec-intelligence/contracts'
import type { TruthLabel } from '@/lib/fantasy-os/exec-intelligence/truth'
import { TruthLabelBadge, fmt } from './primitives'

export function ExecutiveChartCard({
  title,
  subtitle,
  unit,
  truthLabel,
  sourceWindow,
  children,
  empty,
}: {
  title: string
  subtitle: string
  unit: string
  truthLabel: TruthLabel
  sourceWindow: string
  children: ReactNode
  empty?: boolean
}) {
  return (
    <figure className="card-premium flex flex-col gap-3 p-4" data-testid="exec-chart-card">
      <figcaption className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[15px] font-black tracking-tight text-primary">{title}</h3>
          <p className="text-[12px] leading-relaxed text-muted">{subtitle}</p>
        </div>
        <TruthLabelBadge label={truthLabel} />
      </figcaption>
      {empty ? (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-subtle text-[12px] text-muted">
          No data available for this view.
        </div>
      ) : (
        <div className="min-w-0 overflow-x-auto">{children}</div>
      )}
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted">
        Units: {unit} · Source window {sourceWindow}
      </p>
    </figure>
  )
}

const W = 520
const H = 180
const PAD = { top: 16, right: 12, bottom: 26, left: 40 }

function niceMax(v: number): number {
  if (v <= 0) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / mag
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return step * mag
}

/** Vertical bar chart for a single yearly series. */
export function YearBarChart({ series, colorClass = 'text-brand-primary' }: { series: YearlySeries; colorClass?: string }) {
  const pts = series.points
  const max = niceMax(Math.max(1, ...pts.map((p) => p.value)))
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const bw = innerW / Math.max(1, pts.length)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[420px]" role="img" aria-label={`${series.label} by year`}>
      <title>{series.label} by year</title>
      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={H - PAD.bottom} className="stroke-line-strong" strokeWidth={1} />
      <line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom} className="stroke-line-strong" strokeWidth={1} />
      <text x={PAD.left - 6} y={PAD.top + 4} textAnchor="end" className="fill-muted text-[9px]">{fmt(max)}</text>
      <text x={PAD.left - 6} y={H - PAD.bottom} textAnchor="end" className="fill-muted text-[9px]">0</text>
      <g className={colorClass}>
        {pts.map((p, i) => {
          const h = (p.value / max) * innerH
          const x = PAD.left + i * bw + bw * 0.18
          const y = H - PAD.bottom - h
          return (
            <g key={p.season}>
              <rect x={x} y={y} width={bw * 0.64} height={Math.max(0, h)} rx={2} fill="currentColor">
                <title>{`${p.season}: ${fmt(p.value)} ${series.unit}`}</title>
              </rect>
              <text x={x + bw * 0.32} y={y - 3} textAnchor="middle" className="fill-secondary text-[8px] font-semibold">{p.value ? fmt(p.value) : ''}</text>
              <text x={x + bw * 0.32} y={H - PAD.bottom + 12} textAnchor="middle" className="fill-muted text-[9px]">{p.season}</text>
            </g>
          )
        })}
      </g>
    </svg>
  )
}

/** Grouped (side-by-side) bars for a stacked-shape dataset with multiple keys. */
export function GroupedYearChart({
  points,
  keys,
}: {
  points: StackedYearlyPoint[]
  keys: { key: string; label: string; colorClass: string }[]
}) {
  const allVals = points.flatMap((p) => keys.map((k) => Number(p[k.key] ?? 0)))
  const max = niceMax(Math.max(1, ...allVals))
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const groupW = innerW / Math.max(1, points.length)
  const bw = (groupW * 0.7) / keys.length
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[440px]" role="img" aria-label="Activity composition by year">
      <title>Activity composition by year</title>
      <line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom} className="stroke-line-strong" strokeWidth={1} />
      <text x={PAD.left - 6} y={PAD.top + 4} textAnchor="end" className="fill-muted text-[9px]">{fmt(max)}</text>
      {points.map((p, i) => (
        <g key={p.season}>
          {keys.map((k, j) => {
            const v = Number(p[k.key] ?? 0)
            const h = (v / max) * innerH
            const x = PAD.left + i * groupW + groupW * 0.15 + j * bw
            const y = H - PAD.bottom - h
            return (
              <g key={k.key} className={k.colorClass}>
                <rect x={x} y={y} width={bw * 0.9} height={Math.max(0, h)} rx={1.5} fill="currentColor">
                  <title>{`${p.season} · ${k.label}: ${fmt(v)}`}</title>
                </rect>
              </g>
            )
          })}
          <text x={PAD.left + i * groupW + groupW * 0.5} y={H - PAD.bottom + 12} textAnchor="middle" className="fill-muted text-[9px]">{p.season}</text>
        </g>
      ))}
    </svg>
  )
}

/** Horizontal bars for a categorical distribution. */
export function DistributionBars({ data, colorClass = 'text-brand-primary' }: { data: Distribution[]; colorClass?: string }) {
  const max = Math.max(1, ...data.map((d) => d.count))
  return (
    <div className="flex flex-col gap-2">
      {data.map((d) => (
        <div key={d.bucket} className="flex items-center gap-2">
          <span className="w-28 shrink-0 truncate text-[11px] font-medium text-secondary" title={d.bucket}>{d.bucket}</span>
          <div className="relative h-4 flex-1 overflow-hidden rounded bg-surface-muted">
            <div className={`h-full rounded ${colorClass.replace('text-', 'bg-')}`} style={{ width: `${(d.count / max) * 100}%` }} />
          </div>
          <span className="w-12 shrink-0 text-right text-[11px] font-bold tabular-nums text-primary">{fmt(d.count)}</span>
        </div>
      ))}
    </div>
  )
}

export function ChartLegend({ items }: { items: { label: string; colorClass: string }[] }) {
  return (
    <div className="flex flex-wrap gap-3">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5 text-[11px] font-medium text-secondary">
          <span className={`inline-block h-2.5 w-2.5 rounded-sm ${it.colorClass.replace('text-', 'bg-')}`} aria-hidden />
          {it.label}
        </span>
      ))}
    </div>
  )
}
