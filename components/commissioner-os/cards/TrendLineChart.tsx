'use client'

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

interface TrendChartSeries {
  id: string
  name: string
  points: { label: string; value: number }[]
}

interface TrendLineChartProps {
  series: TrendChartSeries[]
  height?: number
  /** Required — Recharts' SVG output carries no semantics of its own, so this is the chart's only accessible description. */
  ariaLabel: string
}

const LINE_COLORS = ['var(--accent-cyan-strong)', 'var(--accent-purple)', 'var(--accent-amber-strong)', 'var(--accent-emerald-strong)']

/**
 * The shared trend-line chart the Component Library deferred at Phase
 * 0.4 (see League Health's README) — built here, in the Card System, so
 * any future module needing a time-series line chart reuses this instead
 * of hand-rolling another Recharts wrapper. Wraps Recharts (already a
 * project dependency, used elsewhere in the app) rather than adding a
 * competing charting library; every color is a `var(--...)` token
 * already defined in globals.css, matching every other themed component
 * in this program instead of the hardcoded hex/rgba values existing
 * Recharts usages elsewhere in the app use.
 */
export function TrendLineChart({ series, height = 280, ariaLabel }: TrendLineChartProps) {
  const pointCount = series[0]?.points.length ?? 0
  const data = Array.from({ length: pointCount }, (_, index) => {
    const row: Record<string, string | number> = { label: series[0]?.points[index]?.label ?? '' }
    for (const s of series) {
      row[s.id] = s.points[index]?.value ?? 0
    }
    return row
  })

  return (
    <div role="img" aria-label={ariaLabel} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="label" tick={{ fill: 'var(--muted2)', fontSize: 11 }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
          <YAxis tick={{ fill: 'var(--muted2)', fontSize: 11 }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
          <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }} />
          <Legend wrapperStyle={{ fontSize: 12, color: 'var(--muted)' }} />
          {series.map((s, index) => (
            <Line
              key={s.id}
              type="monotone"
              dataKey={s.id}
              name={s.name}
              stroke={LINE_COLORS[index % LINE_COLORS.length]}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
