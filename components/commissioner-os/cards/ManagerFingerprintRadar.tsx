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

/** The highest each measure reaches platform-wide — the ring, per axis. See the read layer. */
export interface FingerprintAxisMax {
  aggression: number
  activity: number
  tradeFrequency: number
  riskTolerance: number
}

export interface ManagerFingerprintRadarProps {
  managers: ManagerFingerprint[]
  axisMax: FingerprintAxisMax
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
 * 🛑 EACH AXIS IS PLOTTED AGAINST ITS OWN PLATFORM-WIDE MAXIMUM, AND THE FIRST VERSION'S SHARED
 * 0–100 RING WAS UNREADABLE. Measured across 2,679 rows the four measures top out at 45, 38, 100
 * and 63 — they are not commensurate. On one ring three of them never left the inner fifth: every
 * manager drew the same thin vertical sliver and two of eleven were invisible dots. That was
 * caught by rendering the real league in a browser; the numbers alone looked fine.
 *
 * ⚠ THE DENOMINATOR MUST BE THE PLATFORM MAX, NEVER THIS LEAGUE'S. Scaling to the top score among
 * the managers on screen is the dishonest version — the rim would mean "highest here", it would
 * move whenever someone joined or left, and no two leagues could be compared. A fixed reference
 * means a full spoke reads as "as high as this measure has ever been recorded", which is a real
 * claim. The tooltip carries the RAW score against that maximum so nothing is hidden behind the
 * normalisation, and the panel note states the rule.
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

function Fingerprint({ manager, axisMax }: { manager: ManagerFingerprint; axisMax: FingerprintAxisMax }) {
  const data = AXES.map((axis) => {
    const raw = manager[axis.key]
    const max = axisMax[axis.key]
    return {
      axis: axis.label,
      // Plotted normalised; `raw` and `max` ride along so the tooltip can show the real score.
      value: Math.round((raw / max) * 100),
      raw,
      max,
    }
  })
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
              formatter={(_value, _name, item) => [
                `${item?.payload?.raw ?? 0} of ${item?.payload?.max ?? 0}`,
                String(item?.payload?.axis ?? ''),
              ]}
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

export function ManagerFingerprintRadar({ managers, axisMax, ariaLabel }: ManagerFingerprintRadarProps) {
  if (managers.length === 0) return null
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className="grid gap-3"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}
    >
      {managers.map((m) => (
        <Fingerprint key={m.managerName} manager={m} axisMax={axisMax} />
      ))}
    </div>
  )
}
