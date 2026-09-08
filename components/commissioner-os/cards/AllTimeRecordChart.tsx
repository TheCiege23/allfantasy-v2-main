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

  /*
   * ⚠ THE LABEL IS TRUNCATED BECAUSE RECHARTS WRAPS RATHER THAN CLIPS. Rendered against the real
   * league, "Team Too Many Falcons ★★" broke onto a second line and collided with the rows above
   * and below it. A category axis cannot ellipsise on its own, so the budget is enforced here and
   * the full name stays in the tooltip.
   */
  const NAME_BUDGET = 22
  const data = records.map((r) => {
    // NON-BREAKING space: with a normal one Recharts treats it as a wrap opportunity and drops the
    // stars onto their own line under the name, colliding with the row beneath.
    const stars = r.titles > 0 ? ` ${'★'.repeat(Math.min(r.titles, 3))}` : ''
    const room = NAME_BUDGET - stars.length
    const name = r.teamName.length > room ? `${r.teamName.slice(0, room - 1)}…` : r.teamName
    return { ...r, label: `${name}${stars}` }
  })

  /*
   * The axis stops at the longest bar, not at a round 100. Every team has played the same number
   * of seasons, so the totals cluster tightly — leaving 16 points of empty track past the longest
   * bar just shrinks the part that carries the signal.
   */
  const maxGames = Math.max(...records.map((r) => r.wins + r.losses), 1)

  return (
    <div role="img" aria-label={ariaLabel} style={{ height: resolvedHeight }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
          <XAxis
            type="number"
            domain={[0, maxGames]}
            tick={{ fill: 'var(--muted2)', fontSize: 11 }}
            axisLine={{ stroke: 'var(--border)' }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={158}
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
