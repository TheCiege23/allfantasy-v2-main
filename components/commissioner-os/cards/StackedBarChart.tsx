'use client'

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export interface StackedBarSeries {
  /** Key into each row's `values`. */
  id: string
  label: string
  /** A `var(--...)` token. Callers pass a token so the chart themes with the page, never a hex. */
  color: string
}

export interface StackedBarRow {
  label: string
  values: Record<string, number>
}

export interface StackedBarChartProps {
  rows: StackedBarRow[]
  series: StackedBarSeries[]
  height?: number
  /** Required — Recharts' SVG output carries no semantics of its own, so this is the chart's only accessible description. */
  ariaLabel: string
  /** Horizontal when the category labels are long enough to collide on an x-axis (job types, template names). */
  layout?: 'vertical' | 'horizontal'
}

/**
 * The shared stacked bar — part-to-whole WITHIN each category, where a donut would only show the
 * platform-wide total and lose which category the parts belong to.
 *
 * ⚠ THE CALLER PASSES THE COLOURS, WHICH IS THE OPPOSITE OF `ActivityMixDonut`. That component
 * assigns categorical hues from a fixed list because its slices are arbitrary categories with no
 * inherent meaning. Every use of THIS chart so far stacks outcome states — succeeded, skipped,
 * failed — where the colour is semantic and belongs to the state rather than to its position in a
 * list. A fixed positional palette here would paint "failed" green whenever it happened to sort
 * first, which is the one thing an outcome chart must never do.
 *
 * `stackId` is shared across every series on purpose: these are parts of one total, so a reader
 * comparing two categories is comparing whole bars.
 */
export function StackedBarChart({
  rows,
  series,
  height = 260,
  ariaLabel,
  layout = 'vertical',
}: StackedBarChartProps) {
  // Recharts wants one flat object per row; `values` is nested so the caller does not have to know that.
  const data = rows.map((row) => ({ label: row.label, ...row.values }))
  const horizontal = layout === 'horizontal'

  return (
    <div role="img" aria-label={ariaLabel} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout={horizontal ? 'vertical' : 'horizontal'}
          margin={{ top: 8, right: 8, left: horizontal ? 8 : -16, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          {horizontal ? (
            <>
              <XAxis type="number" tick={{ fill: 'var(--muted2)', fontSize: 11 }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
              {/* Wide enough for a job type or a report template name without truncating it. */}
              <YAxis
                type="category"
                dataKey="label"
                width={150}
                tick={{ fill: 'var(--muted2)', fontSize: 11 }}
                axisLine={{ stroke: 'var(--border)' }}
                tickLine={false}
              />
            </>
          ) : (
            <>
              <XAxis dataKey="label" tick={{ fill: 'var(--muted2)', fontSize: 11 }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
              <YAxis tick={{ fill: 'var(--muted2)', fontSize: 11 }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
            </>
          )}
          <Tooltip
            contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: 'var(--muted)' }} />
          {series.map((s, index) => (
            <Bar
              key={s.id}
              dataKey={s.id}
              name={s.label}
              stackId="total"
              fill={s.color}
              /*
               * Only the last series in the stack gets rounded ends, so the stack reads as one bar
               * rather than as several bars butted together.
               */
              radius={
                index === series.length - 1
                  ? horizontal
                    ? [0, 4, 4, 0]
                    : [4, 4, 0, 0]
                  : undefined
              }
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
