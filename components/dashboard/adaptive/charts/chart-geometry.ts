/**
 * Shared SVG geometry for the adaptive dashboard chart kit.
 *
 * Every chart in `./` is a thin presentational wrapper over these pure functions, so the
 * maths lives in exactly one place and future surfaces (League Home, My Team, Players,
 * Commissioner HQ) reuse the same primitives instead of re-deriving one-off SVG per screen.
 *
 * Ported from the design reference's `ring`/`poly`/`areaPathFrom`/`radarPts`/`radarAxis`
 * helpers, with the domain edge cases the reference glossed over made explicit:
 *  - an empty series returns an empty path rather than `NaN,NaN` point strings
 *  - a flat series (max === min) renders on the baseline instead of dividing by zero
 *  - percentages clamp to 0–100 so a bad upstream value can't draw an arc past full
 */

/** Stroke-dasharray pair for a ring segment. */
export type RingDash = {
  /** Dash for the unfilled track. */
  track: string
  /** Dash for the filled foreground arc. */
  fg: string
}

/**
 * Dasharray values for a circular gauge/donut of radius `r` filled to `pct` (0–100).
 *
 * `sweep` is the fraction of the full circle the gauge occupies — 1 for a closed donut,
 * 0.75 for the 270° gauge in the KPI row. The caller is responsible for the matching
 * `transform="rotate(...)"`; this only produces the dash lengths.
 */
export function ring(r: number, pct: number, sweep = 1): RingDash {
  const circumference = 2 * Math.PI * r
  const arc = circumference * clamp01(sweep)
  const filled = (arc * clampPct(pct)) / 100
  return {
    track: `${arc.toFixed(1)} ${circumference.toFixed(1)}`,
    fg: `${filled.toFixed(1)} ${circumference.toFixed(1)}`,
  }
}

/**
 * `points` string for a polyline across `values`, auto-scaled to the box.
 *
 * The y-domain is the series' own min/max (not zero-based) so small week-to-week movement
 * still reads as a shape — the sparkline's job is trend, not absolute magnitude. A flat
 * series has no meaningful shape, so it renders as a straight line at mid-height.
 */
export function poly(values: number[], w: number, h: number, pad = 0): string {
  const pts = polyPoints(values, w, h, pad)
  return pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
}

/** Same scaling as `poly`, as coordinate pairs — for callers that need the points themselves. */
export function polyPoints(values: number[], w: number, h: number, pad = 0): Array<[number, number]> {
  const finite = values.filter((v) => Number.isFinite(v))
  if (finite.length === 0) return []
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  const span = max - min
  const n = finite.length
  const innerW = w - 2 * pad
  const innerH = h - 2 * pad
  return finite.map((v, i) => {
    const x = pad + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1))
    // Flat series: centre the line rather than pinning it to the floor (span === 0 → /0).
    const t = span === 0 ? 0.5 : (v - min) / span
    return [x, h - pad - innerH * t]
  })
}

/**
 * Closed area path under a polyline, for the gradient fill beneath a line chart.
 * Returns '' for an empty series so the `<path>` renders nothing instead of throwing.
 */
export function areaPath(values: number[], w: number, h: number, pad = 0): string {
  const pts = polyPoints(values, w, h, pad)
  if (pts.length === 0) return ''
  const body = pts.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const firstX = pts[0][0]
  const lastX = pts[pts.length - 1][0]
  const floor = h - pad
  return `M${firstX.toFixed(1)},${floor} ${body} L${lastX.toFixed(1)},${floor} Z`
}

/** Polygon `points` for a radar series, `values` measured against a shared `max`. */
export function radarPoints(values: number[], max: number, cx: number, cy: number, r: number): string {
  const n = values.length
  if (n === 0 || max <= 0) return ''
  return values
    .map((v, i) => {
      const angle = ((-90 + i * (360 / n)) * Math.PI) / 180
      const rr = r * clamp01(v / max)
      return `${(cx + rr * Math.cos(angle)).toFixed(1)},${(cy + rr * Math.sin(angle)).toFixed(1)}`
    })
    .join(' ')
}

export type RadarAxis = {
  x1: number; y1: number; x2: number; y2: number
  /** Label anchor, pushed out past the axis end. */
  lx: number; ly: number
  label: string
}

/** Spoke + label geometry for a radar chart's axes. */
export function radarAxes(labels: string[], cx: number, cy: number, r: number, labelOffset = 15): RadarAxis[] {
  const n = labels.length
  if (n === 0) return []
  return labels.map((label, i) => {
    const angle = ((-90 + i * (360 / n)) * Math.PI) / 180
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    return {
      x1: cx,
      y1: cy,
      x2: cx + r * cos,
      y2: cy + r * sin,
      lx: cx + (r + labelOffset) * cos,
      ly: cy + (r + labelOffset) * sin,
      label,
    }
  })
}

/** Bar heights (px) for a mini column chart, scaled to `maxHeight` with a visible floor. */
export function columnHeights(values: number[], maxHeight: number, minHeight = 4): number[] {
  const finite = values.filter((v) => Number.isFinite(v))
  if (finite.length === 0) return []
  const max = Math.max(...finite)
  // All-zero weeks are real data (nobody traded); render the floor, not a divide-by-zero.
  if (max <= 0) return finite.map(() => minHeight)
  return finite.map((v) => Math.round((Math.max(0, v) / max) * maxHeight) + minHeight)
}

/** Scale a value from an arbitrary domain into a pixel span. */
export function scaleLinear(value: number, domainMin: number, domainMax: number, rangeMin: number, rangeMax: number): number {
  const span = domainMax - domainMin
  if (span === 0) return (rangeMin + rangeMax) / 2
  const t = (value - domainMin) / span
  return rangeMin + (rangeMax - rangeMin) * t
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(1, v))
}

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(100, v))
}
