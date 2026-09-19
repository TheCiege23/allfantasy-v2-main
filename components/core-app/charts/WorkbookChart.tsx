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

/** How many bars fit before the plot stops being readable. */
export const MAX_BARS = 10

/**
 * A small, dependency-free chart for operational screens. It deliberately keeps
 * an axis, gridlines and the value table visible, so the graphic can be audited
 * like a spreadsheet chart instead of behaving as decoration.
 *
 * 🛑 AND AUDITABLE MEANS IT HAS TO ADMIT WHAT IT LEFT OUT. The cap is necessary —
 * eleven bars in this plot are unreadable — but it was applied SILENTLY, so a
 * reader could not tell ten leagues from forty. `FormatHub` passes every league of
 * a format with no slice of its own, and the `key` note above cites the very
 * account that overflows it: eleven guillotine leagues under seven names. Its
 * "league comparison" showed ten of eleven and said nothing.
 *
 * The count now rides in the caption AND in the plot's accessible name, so it
 * reaches a screen reader too — a chart that quietly drops a row is exactly the
 * decoration this component was written not to be.
 *
 * ⚠ NEGATIVE VALUES ARE NOT PLOTTABLE HERE, AND NO CALLER PASSES THEM TODAY. The
 * geometry has no baseline: `Math.max(0, …)` floors both the scale and the bar, so
 * a −40 would render flat — indistinguishable from a 0 — while its own label
 * printed "-40". Every current consumer plots counts, percentages or points-for.
 * A caller that needs signed values needs a baseline axis, not this component.
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
  const plottable = data.filter((row) => Number.isFinite(row.value))
  const clean = plottable.slice(0, MAX_BARS)
  if (clean.length === 0) return null

  /*
   * ⚠ COUNTED AFTER THE FINITE FILTER, NOT BEFORE. A NaN row was never going to be a bar, and
   * telling the reader "10 of 12" when two of those twelve were unplottable would replace a
   * silent omission with a wrong number — which is worse, because it looks like an answer.
   */
  const omitted = plottable.length - clean.length
  const omissionNote = omitted > 0 ? `Showing ${clean.length} of ${plottable.length}` : null

  const maximum = Math.max(1, ...clean.map((row) => Math.max(0, row.value)))

  return (
    <figure className="af-workbook-chart">
      <figcaption>
        <span>
          <b>{title}</b>
          {/*
            Joined into the existing subtitle line rather than added beside it: the caption is a
            two-column grid and a third element would push the value label off a narrow phone.
          */}
          {subtitle || omissionNote ? (
            <small className="af-workbook-sub" data-truncated={omissionNote ? 'true' : undefined}>
              {[subtitle, omissionNote].filter(Boolean).join(' · ')}
            </small>
          ) : null}
        </span>
        <em>{valueLabel}</em>
      </figcaption>
      {/*
        ⚠ THE OMISSION IS IN THE ACCESSIBLE NAME TOO. A caption a sighted reader can see is not a
        disclosure for someone hearing `role="img"` — the label is the only thing they get, and a
        list of ten that never says it is ten of eleven reads as the whole set.
      */}
      <div
        className="af-workbook-plot"
        role="img"
        aria-label={`${title}. ${omissionNote ? `${omissionNote}. ` : ''}${clean
          .map((row) => `${row.label}: ${row.displayValue ?? compact(row.value)}`)
          .join(', ')}`}
      >
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
