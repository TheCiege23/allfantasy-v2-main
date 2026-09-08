'use client'

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export interface AllTimeRecord {
  teamName: string
  wins: number
  losses: number
  seasons: number
  titles: number
}

export interface AllTimeRecordChartProps {
  records: AllTimeRecord[]
  height?: number
  ariaLabel: string
}

/**
 * All-time wins and losses per franchise, as a horizontal stacked bar.
 *
 * Horizontal because team names are words, not dates — rotating a dozen of them under a vertical
 * axis is what forced the truncation on the points chart. Stacked rather than grouped because
 * wins + losses IS the games played, so the full bar length carries a real meaning (tenure) and
 * the split carries the record. A grouped pair would put two unrelated lengths side by side and
 * lose that.
 *
 * ⚠ ONE X-AXIS, GAMES. Titles are NOT a second axis — a trophy count of 0–2 sharing a scale with a
 * win count of 0–63 would be invisible, and giving it its own axis would make this a dual-axis
 * chart, which is the single most misread chart form there is. Titles ride in the label and the
 * tooltip instead, where a small integer is legible.
 */
export function AllTimeRecordChart({ records, height, ariaLabel }: AllTimeRecordChartProps) {
  if (records.length === 0) return null
  // Height follows the row count so bars keep a constant thickness whatever the league size —
  // twelve teams in a fixed frame gives slivers, four gives slabs.
  const resolvedHeight = height ?? Math.max(200, records.length * 26 + 48)

  const data = records.map((r) => ({
    ...r,
    // Pre-computed so the tick formatter stays a pure lookup rather than re-deriving per render.
    label: r.titles > 0 ? `${r.teamName} ${'★'.repeat(Math.min(r.titles, 3))}` : r.teamName,
  }))

  return (
    <div role="img" aria-label={ariaLabel} style={{ height: resolvedHeight }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fill: 'var(--muted2)', fontSize: 11 }}
            axisLine={{ stroke: 'var(--border)' }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={150}
            tick={{ fill: 'var(--muted2)', fontSize: 11 }}
            axisLine={{ stroke: 'var(--border)' }}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
            formatter={(value, name) => [String(value), String(name)]}
            labelFormatter={(label) => {
              const row = data.find((d) => d.label === label)
              if (!row) return String(label)
              const titles = row.titles === 1 ? '1 title' : `${row.titles} titles`
              return `${row.teamName} — ${row.seasons} season${row.seasons === 1 ? '' : 's'}, ${titles}`
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: 'var(--muted)' }} />
          <Bar dataKey="wins" name="Wins" stackId="record" fill="var(--accent-emerald-strong)" radius={[4, 0, 0, 4]} isAnimationActive={false} />
          <Bar dataKey="losses" name="Losses" stackId="record" fill="var(--accent-red-strong)" radius={[0, 4, 4, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
