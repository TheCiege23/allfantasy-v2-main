'use client'

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

export interface ActivityMixSlice {
  label: string
  value: number
}

export interface ActivityMixDonutProps {
  slices: ActivityMixSlice[]
  height?: number
  /** Required — Recharts' SVG output carries no semantics of its own, so this is the chart's only accessible description. */
  ariaLabel: string
}

/**
 * Part-to-whole for a small number of categories — the one job a donut does better than a bar.
 *
 * ⚠ CATEGORICAL HUES ARE ASSIGNED IN FIXED ORDER AND NEVER CYCLED. Past this list a slice would
 * reuse an earlier hue and two different categories would read as the same thing, so anything
 * beyond it folds into "Other" rather than wrapping around. Today the source emits four types
 * (draft pick, roster move, trade, waiver), so the list has room; the fold exists because a new
 * provider adding a fifth should not silently repaint the chart.
 *
 * Every colour is a `var(--...)` token, matching `TrendLineChart` and `DistributionBarChart` rather
 * than the hardcoded hex values Recharts usages elsewhere in the app carry.
 */
const SLICE_COLORS = [
  'var(--accent-cyan-strong)',
  'var(--accent-purple)',
  'var(--accent-amber-strong)',
  'var(--accent-emerald-strong)',
  'var(--accent-red-strong)',
]

const MAX_SLICES = SLICE_COLORS.length

export function ActivityMixDonut({ slices, height = 260, ariaLabel }: ActivityMixDonutProps) {
  const ordered = [...slices].sort((a, b) => b.value - a.value)
  const shown = ordered.slice(0, MAX_SLICES - 1)
  const rest = ordered.slice(MAX_SLICES - 1)
  const data =
    rest.length > 1
      ? [...shown, { label: 'Other', value: rest.reduce((sum, s) => sum + s.value, 0) }]
      : ordered

  const total = data.reduce((sum, s) => sum + s.value, 0)
  if (total === 0) return null

  return (
    <div role="img" aria-label={ariaLabel} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            // A donut, not a pie: the hole is where the total goes, and an arc is easier to compare
            // by length than a wedge is by area.
            innerRadius="52%"
            outerRadius="80%"
            paddingAngle={2}
            // Off deliberately: a dashboard people READ VALUES OFF should be complete on first
            // paint, not sweep in. It also respects reduced-motion by construction rather than by
            // a media query the chart library would ignore.
            isAnimationActive={false}
            stroke="var(--panel)"
            strokeWidth={2}
            // The count AND its share — a percentage alone hides that 7 trades is seven trades.
            label={({ name, value }) =>
              `${String(name)} ${value} · ${Math.round((Number(value) / total) * 100)}%`
            }
            labelLine={{ stroke: 'var(--border)' }}
          >
            {data.map((slice, index) => (
              <Cell key={slice.label} fill={SLICE_COLORS[index]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
            formatter={(value, name) => [`${value} (${Math.round((Number(value) / total) * 100)}%)`, String(name)]}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: 'var(--muted)' }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
