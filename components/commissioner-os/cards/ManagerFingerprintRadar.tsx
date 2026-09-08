'use client'

import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from 'recharts'

export interface ManagerFingerprint {
  managerName: string
  aggression: number
  activity: number
  tradeFrequency: number
  riskTolerance: number
  labels: string[]
}

export interface ManagerFingerprintRadarProps {
  managers: ManagerFingerprint[]
  ariaLabel: string
}

/**
 * Behavioural fingerprints as SMALL MULTIPLES — one mini radar per manager, never overlaid.
 *
 * ⚠ OVERLAYING TWELVE MANAGERS ON ONE RADAR WOULD BREAK THE CATEGORICAL-COLOUR RULE AND BE
 * UNREADABLE ANYWAY. Past a handful of series a chart needs a generated hue per entity, and two
 * managers then read as the same colour. Small multiples sidestep it entirely: each panel is a
 * SINGLE series, so no hue carries identity and no legend is needed — the heading is the label.
 * Comparing shapes across a grid is also the thing a fingerprint is for.
 *
 * ⚠ THE DOMAIN IS A HARD 0–100 AND IS NOT RESCALED TO THE LEAGUE'S MAXIMUM. These are 0–100
 * scores, and stretching each axis to whatever the top manager happened to score would turn "the
 * most aggressive manager here" into a spoke at the rim that reads as "maximally aggressive". The
 * cost is honest and visible: in most leagues the polygons sit well inside the ring, because real
 * scores cluster low. The panel note says so rather than the chart quietly flattering everyone.
 *
 * ⚠ FOUR AXES, NOT FIVE. `waiverFocusScore` exists on the source table and is constant zero across
 * all 2,611 rows platform-wide; it is dropped in the read layer so no chart can pick it up by
 * accident. A fifth permanently-collapsed spoke would read as "nobody here uses waivers".
 */
const AXES: { key: keyof Omit<ManagerFingerprint, 'managerName' | 'labels'>; label: string }[] = [
  { key: 'aggression', label: 'Aggression' },
  { key: 'activity', label: 'Activity' },
  { key: 'tradeFrequency', label: 'Trading' },
  { key: 'riskTolerance', label: 'Risk' },
]

function Fingerprint({ manager }: { manager: ManagerFingerprint }) {
  const data = AXES.map((axis) => ({ axis: axis.label, value: manager[axis.key] }))
  return (
    <figure className="m-0">
      <figcaption
        className="truncate text-xs font-semibold"
        style={{ color: 'var(--text)' }}
        title={manager.managerName}
      >
        {manager.managerName}
      </figcaption>
      {manager.labels.length > 0 ? (
        <p className="truncate text-[10px]" style={{ color: 'var(--muted2)' }} title={manager.labels.join(', ')}>
          {manager.labels.join(' · ')}
        </p>
      ) : null}
      <div style={{ height: 150 }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data} margin={{ top: 8, right: 18, bottom: 4, left: 18 }} outerRadius="72%">
            <PolarGrid stroke="var(--border)" />
            <PolarAngleAxis dataKey="axis" tick={{ fill: 'var(--muted2)', fontSize: 9 }} />
            {/* Ticks hidden but the domain pinned: the ring IS 100, stated once in the panel note. */}
            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
            <Tooltip
              contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
              formatter={(value, _name, item) => [`${value} / 100`, String(item?.payload?.axis ?? '')]}
            />
            <Radar
              dataKey="value"
              stroke="var(--accent-cyan-strong)"
              fill="var(--accent-cyan-strong)"
              fillOpacity={0.28}
              strokeWidth={2}
              isAnimationActive={false}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  )
}

export function ManagerFingerprintRadar({ managers, ariaLabel }: ManagerFingerprintRadarProps) {
  if (managers.length === 0) return null
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className="grid gap-3"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}
    >
      {managers.map((m) => (
        <Fingerprint key={m.managerName} manager={m} />
      ))}
    </div>
  )
}
