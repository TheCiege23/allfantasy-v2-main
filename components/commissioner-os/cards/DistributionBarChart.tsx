'use client'

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { cardsCopy } from '@/lib/commissioner-os/i18n/cardsCopy'

export interface DistributionBarPoint {
  label: string
  value: number
}

export interface DistributionBarChartProps {
  data: DistributionBarPoint[]
  height?: number
  /** Required — Recharts' SVG output carries no semantics of its own, so this is the chart's only accessible description. */
  ariaLabel: string
  valueLabel?: string
}

/**
 * The shared single-series bar chart — reused three times in League
 * Analytics alone (scoring distribution, roster utilization, season
 * comparison) precisely so those three metrics don't each get their own
 * bespoke chart component. See `TrendLineChart` for the multi-series
 * sibling and the same theming rationale.
 */
export function DistributionBarChart({ data, height = 240, ariaLabel, valueLabel: valueLabelProp }: DistributionBarChartProps) {
  // Only the DEFAULT is the chart's own word; a caller's `valueLabel` is theirs and passes as given.
  const { language } = useOptionalLanguage()
  const valueLabel = valueLabelProp ?? cardsCopy('Value', language)
  return (
    <div role="img" aria-label={ariaLabel} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="label" tick={{ fill: 'var(--muted2)', fontSize: 11 }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
          <YAxis tick={{ fill: 'var(--muted2)', fontSize: 11 }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
          <Tooltip
            contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
            formatter={(value) => [String(value), valueLabel]}
          />
          <Bar dataKey="value" name={valueLabel} fill="var(--accent-cyan-strong)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
