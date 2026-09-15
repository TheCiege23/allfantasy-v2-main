import '@/components/core-app/charts/workbook-chart.css'

export type WorkbookDatum = {
  label: string
  value: number
  displayValue?: string
  tone?: 'accent' | 'good' | 'warn' | 'bad' | 'muted'
}

function compact(value: number): string {
  return Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

/**
 * A small, dependency-free chart for operational screens. It deliberately keeps
 * an axis, gridlines and the value table visible, so the graphic can be audited
 * like a spreadsheet chart instead of behaving as decoration.
 */
export function WorkbookBarChart({
  title,
  subtitle,
  data,
  valueLabel = 'Value',
}: {
  title: string
  subtitle?: string
  data: WorkbookDatum[]
  valueLabel?: string
}) {
  const clean = data
    .filter((row) => Number.isFinite(row.value))
    .slice(0, 10)
  if (clean.length === 0) return null

  const maximum = Math.max(1, ...clean.map((row) => Math.max(0, row.value)))

  return (
    <figure className="af-workbook-chart">
      <figcaption>
        <span>
          <b>{title}</b>
          {subtitle ? <small>{subtitle}</small> : null}
        </span>
        <em>{valueLabel}</em>
      </figcaption>
      <div className="af-workbook-plot" role="img" aria-label={`${title}. ${clean.map((row) => `${row.label}: ${row.displayValue ?? compact(row.value)}`).join(', ')}`}>
        <div className="af-workbook-grid" aria-hidden>
          <i /><i /><i /><i /><i />
        </div>
        <div className="af-workbook-bars">
          {clean.map((row) => {
            const height = Math.max(row.value > 0 ? 5 : 0, (Math.max(0, row.value) / maximum) * 100)
            return (
            <div
              className="af-workbook-column"
              key={row.label}
              style={{ ['--bar-height' as string]: `${height}%` }}
            >
              <span className="af-workbook-value">{row.displayValue ?? compact(row.value)}</span>
              <span
                className="af-workbook-bar"
                data-tone={row.tone ?? 'accent'}
                style={{ height: `${height}%` }}
              />
              <span className="af-workbook-label" title={row.label}>{row.label}</span>
            </div>
          )})}
        </div>
      </div>
    </figure>
  )
}
