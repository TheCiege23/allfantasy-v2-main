'use client'

import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from 'recharts'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { cardsCopy } from '@/lib/commissioner-os/i18n/cardsCopy'

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

/**
 * ⚠ SPANISH NEEDS WIDER SIDE MARGINS, BECAUSE "Actividad" IS THE RIGHT-HAND LABEL. Measured
 * 2026-10-06 in Inter 11px in a browser: "Activity" 38.98px, "Actividad" 48.64px (1.25×), "Riesgo"
 * 35.31px on the left. The space a horizontal label gets is `0.14·width + 0.72·margin − 8` while the
 * ring is width-bound (see the sweep below), so at the grid's 170px floor margin 30 leaves ~37.4px —
 * "Actividad" would clip by ~11px, silently. 46 leaves ~48.9px, enough for the larger of the two
 * measurements of "Activity" scaled by 1.25. The cost is a smaller ring on a narrow card only: past
 * ~230px the ring is height-bound and both languages draw it the same size. English keeps 30 byte
 * for byte. The vertical labels ("Agresividad", "Intercambios") are centred on the axis with the
 * whole half-width to spare and do not compete for this space.
 */
const SIDE_MARGIN = { en: 30, es: 46 } as const

function Fingerprint({ manager, axisMax }: { manager: ManagerFingerprint; axisMax: FingerprintAxisMax }) {
  const { language } = useOptionalLanguage()
  const side = language === 'es' ? SIDE_MARGIN.es : SIDE_MARGIN.en
  const data = AXES.map((axis) => {
    const raw = manager[axis.key]
    const max = axisMax[axis.key]
    return {
      axis: cardsCopy(axis.label, language),
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
        <p className="truncate text-[11px]" style={{ color: 'var(--muted2)' }} title={manager.labels.join(', ')}>
          {manager.labels.join(' · ')}
        </p>
      ) : null}
      <div style={{ height: 150 }}>
        {/*
           * ⚠ THE 30px SIDE MARGINS BUY ROOM FOR "Activity", AND 18 IS NOT ENOUGH. Do not trim
           * them back to match top/bottom — it clips the label on a narrow card, silently.
           *
           * The axis labels sit OUTSIDE the ring, so the space one gets is
           * `width/2 - outerRadius - 8` (the 8 is recharts' own `tickSize || 8` in
           * PolarAngleAxis.getTickLineCoord), and a horizontal label extends away from its
           * anchor because getTickTextAnchor returns start/end by `cos`. "Activity" is the widest
           * of the four at 35.6px in Inter 11px — "Aggression" is wider still but sits at a
           * VERTICAL extreme, centred on cx with the whole half-width to spare, so it never
           * competes for this space.
           *
           * Measured 2026-09-29, card width vs space for the label:
           *
           *            margin 18   margin 30
           *   150px      26.0        34.6      <- was the grid minimum; NOT reachable any more
           *   164px      27.9        36.6      <- a 2-up phone layout lands about here
           *   187px      35.8        47.6
           *
           * At 18 the label needs a 187px card. At 30 the narrowest card that clips NOTHING is
           * 158px — swept against recharts' own tick anchors rather than derived (150px still
           * overflowed by 1.0px, 157px by 0.02px, 158px clean). That measurement is why the grid
           * minimum below is 170px: the margin alone does not finish the job.
           *
           * 🛑 THE SENTENCE THAT USED TO SIT HERE WAS WRONG, AND ITS OWN TABLE DISPROVED IT. It
           * read "at 30 it needs 157px, which is under the grid's own minimum, so it fits at every
           * width this grid can produce" — wrong twice, because 157 is ABOVE the 150 minimum it
           * was being compared to, and the table three lines up already showed 34.6px of space
           * against 35.6px of text. Two numbers in the same comment contradicted each other and
           * the prose won. Read the table.
           *
           * The cost is a smaller ring — radius 46.1 -> 37.4 at a 164px card — accepted
           * deliberately: a clipped word is worse than a slightly smaller chart.
           *
           * ⚠ This was a PRE-EXISTING clip that the 11px type floor widened, not a new one. At
           * the old 9px the label was 29.1px and already overflowed a 150px card by 3.1px; the
           * floor took it to 9.6px. Restoring 9px would not fix it and would breach the floor —
           * see __tests__/core-app/type-floor.test.ts.
           */}
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data} margin={{ top: 8, right: side, bottom: 4, left: side }} outerRadius="72%">
            <PolarGrid stroke="var(--border)" />
            <PolarAngleAxis dataKey="axis" tick={{ fill: 'var(--muted2)', fontSize: 11 }} />
            {/* Ticks hidden but the domain pinned: the ring IS 100, stated once in the panel note. */}
            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
            <Tooltip
              contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
              formatter={(_value, _name, item) => [
                cardsCopy(`${item?.payload?.raw ?? 0} of ${item?.payload?.max ?? 0}`, language),
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

/**
 * 170px, not the original 150px: a card narrower than 158px clips the "Activity" axis label even
 * with the widened side margins — see the measured sweep in `Fingerprint` above. 170 leaves 12px
 * of headroom for a longer label or a font change.
 *
 * ⚠ `min(170px, 100%)` rather than a bare 170px, because a bare track floor OVERFLOWS THE PAGE
 * once the container is narrower than it — raising 150 to 170 would have raised that threshold
 * too, trading a clipped word for a horizontally scrolling page. The clamp retires the question
 * instead of making it 20px worse, and it is this repo's existing idiom (11 other
 * `minmax(min(...))` tracks).
 */
const FINGERPRINT_GRID = 'repeat(auto-fit, minmax(min(170px, 100%), 1fr))'

export function ManagerFingerprintRadar({ managers, axisMax, ariaLabel }: ManagerFingerprintRadarProps) {
  if (managers.length === 0) return null
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className="grid gap-3"
      style={{ gridTemplateColumns: FINGERPRINT_GRID }}
    >
      {managers.map((m) => (
        <Fingerprint key={m.managerName} manager={m} axisMax={axisMax} />
      ))}
    </div>
  )
}
