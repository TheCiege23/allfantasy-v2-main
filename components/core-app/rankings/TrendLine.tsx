/**
 * TrendLine — a small line chart that is also a table.
 *
 * ⚠ THE TABLE IS THE CONTENT; THE LINE IS A SUMMARY OF IT. The SVG is
 * `aria-hidden` and the same points are always rendered as a `<table>` inside a
 * `<details>`, so the numbers are reachable without reading a chart. The
 * visible one-line summary under the title says the first and last value, which
 * is what most people want from a trend anyway.
 *
 * ⚠ A GAP IS DRAWN AS A GAP. A day with no snapshot is `null`, and the line
 * breaks there instead of being joined across — joining would invent a
 * trajectory for days nothing was recorded.
 *
 * ⚠ RANK IS INVERTED. On a rank line, up means better, so #1 plots at the top.
 */

export type TrendDatum = { label: string; value: number | null; display?: string }

const W = 240
const H = 64
const PAD = 6

export function TrendLine({
  title,
  points,
  invert = false,
  format = (n) => n.toFixed(1),
  empty,
  unit,
}: {
  title: string
  points: TrendDatum[]
  /** True for ranks, where lower is better. */
  invert?: boolean
  format?: (n: number) => string
  /** Shown instead of the chart when no point carries a value. */
  empty: string
  unit?: string
}) {
  const valued = points.filter((p): p is TrendDatum & { value: number } => p.value != null)
  if (valued.length === 0) {
    return (
      <figure className="af-rk-trend">
        <figcaption className="af-rk-trend-title">{title}</figcaption>
        <p className="af-rk-trend-empty">{empty}</p>
      </figure>
    )
  }

  const min = Math.min(...valued.map((p) => p.value))
  const max = Math.max(...valued.map((p) => p.value))
  const span = max - min || 1
  const x = (i: number) => (points.length === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (points.length - 1))
  const y = (v: number) => {
    const t = (v - min) / span
    return invert ? PAD + t * (H - 2 * PAD) : H - PAD - t * (H - 2 * PAD)
  }

  const segments: string[] = []
  let current = ''
  points.forEach((p, i) => {
    if (p.value == null) {
      if (current) segments.push(current)
      current = ''
      return
    }
    current += `${current ? ' L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`
  })
  if (current) segments.push(current)

  const first = valued[0]
  const last = valued[valued.length - 1]
  const show = (p: TrendDatum & { value: number }) => p.display ?? `${invert ? '#' : ''}${format(p.value)}${unit ?? ''}`
  const delta = last.value - first.value
  const better = invert ? delta < 0 : delta > 0
  const worse = invert ? delta > 0 : delta < 0

  return (
    <figure className="af-rk-trend">
      <figcaption className="af-rk-trend-title">
        {title}
        <span className={`af-rk-trend-now${better ? ' af-rk-tone-good' : worse ? ' af-rk-tone-bad' : ''}`}>
          {valued.length > 1 ? `${show(first)} → ${show(last)}` : show(last)}
        </span>
      </figcaption>
      <svg className="af-rk-trend-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <line x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} className="af-rk-trend-axis" />
        {segments.map((d, i) => (
          <path key={i} d={d} className="af-rk-trend-path" />
        ))}
        {points.map((p, i) =>
          p.value == null ? null : <circle key={i} cx={x(i)} cy={y(p.value)} r={i === points.length - 1 ? 3.2 : 2} className="af-rk-trend-dot" />,
        )}
      </svg>
      <details className="af-rk-trend-table">
        <summary>Show as a table</summary>
        <table className="af-rk-mini-table">
          <caption className="af-rk-sr">{title}</caption>
          <thead>
            <tr>
              <th scope="col">Point</th>
              <th scope="col">{invert ? 'Rank' : 'Value'}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.label}>
                <th scope="row">{p.label}</th>
                <td>{p.value == null ? 'Not recorded' : show(p as TrendDatum & { value: number })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

export default TrendLine
