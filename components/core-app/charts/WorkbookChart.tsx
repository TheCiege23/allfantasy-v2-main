import type { ReactNode } from 'react'
import '@/components/core-app/charts/workbook-chart.css'

export type WorkbookDatum = {
  /**
   * What identifies this bar — a league or roster id. Labels are display names and
   * repeat: one account had 11 guillotine leagues under 7 names, and bars keyed by
   * name collided. Without a key the bar's position tells same-named bars apart.
   */
  key?: string
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
  footer = null,
}: {
  title: string
  subtitle?: string
  data: WorkbookDatum[]
  valueLabel?: string
  /** Rendered inside the figure, under the plot — e.g. a freshness line, so it belongs to this card. */
  footer?: ReactNode
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
          {clean.map((row, index) => {
            const height = Math.max(row.value > 0 ? 5 : 0, (Math.max(0, row.value) / maximum) * 100)
            return (
            <div
              className="af-workbook-column"
              key={row.key ?? `${index}:${row.label}`}
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
      {footer}
    </figure>
  )
}
