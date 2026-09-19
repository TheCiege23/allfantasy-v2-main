import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

/*
 * 🛑 A CHART BUILT TO BE AUDITED WAS DROPPING ROWS WITHOUT SAYING SO.
 *
 * `WorkbookBarChart`'s own docblock says it keeps an axis, gridlines and the value table visible
 * "so the graphic can be audited like a spreadsheet chart instead of behaving as decoration".
 * It then applied `.slice(0, 10)` silently, so a reader could not tell ten leagues from forty.
 *
 * `FormatHub` passes EVERY league of a format with no slice of its own — and the component's own
 * `key` note cites the account that overflows it: eleven guillotine leagues under seven names.
 * Its "league comparison" showed ten of eleven and said nothing at all.
 *
 * ⚠ THE CAPTION IS NOT A DISCLOSURE FOR EVERYONE. The plot is `role="img"`, so a screen reader
 * gets the accessible name and nothing else. A list of ten that never says it is ten of eleven
 * reads as the whole set, which is why the count is asserted in BOTH places below.
 */

import { WorkbookBarChart, MAX_BARS } from '@/components/core-app/charts/WorkbookChart'

function rows(n: number) {
  return Array.from({ length: n }, (_, i) => ({ key: `k${i}`, label: `League ${i + 1}`, value: n - i }))
}

describe('WorkbookBarChart truncation', () => {
  /*
   * ⚠ THE DISCLOSURE ASSERTIONS USE A LITERAL, NOT `MAX_BARS`, ON PURPOSE. Interpolating the
   * constant makes the failure read "expected … to contain 'Showing undefined of 11'" against a
   * build that has no such export — a missing-symbol message dressed as a behavioural one. The
   * literal fails for the real reason: the sentence is not there. The constant is pinned on its
   * own below, so the two cannot drift apart silently.
   */
  it('pins the cap the literals below assume', () => {
    expect(MAX_BARS).toBe(10)
  })

  it('says how many it is showing when it has to cut', () => {
    const { container } = render(<WorkbookBarChart title="League comparison" data={rows(11)} />)
    expect(container.textContent).toContain('Showing 10 of 11')
  })

  it('puts the same admission in the accessible name, not only the caption', () => {
    const { container } = render(<WorkbookBarChart title="League comparison" data={rows(11)} />)
    const plot = container.querySelector('[role="img"]')
    expect(plot?.getAttribute('aria-label') ?? '').toContain('Showing 10 of 11')
  })

  it('still draws only what fits', () => {
    const { container } = render(<WorkbookBarChart title="League comparison" data={rows(11)} />)
    expect(container.querySelectorAll('.af-workbook-column')).toHaveLength(MAX_BARS)
  })

  /*
   * ⚠ THE CONTROL AGAINST OVER-ROTATING. A chart that announces a cut it did not make is its own
   * kind of lie, and it would appear on every small chart in the product.
   */
  it('says nothing when nothing was cut', () => {
    const { container } = render(<WorkbookBarChart title="Small" data={rows(10)} />)
    expect(container.textContent).not.toContain('Showing')
    const plot = container.querySelector('[role="img"]')
    expect(plot?.getAttribute('aria-label')).not.toContain('Showing')
  })

  it('keeps the subtitle when it adds the note', () => {
    const { container } = render(
      <WorkbookBarChart title="League comparison" subtitle="Survival rate" data={rows(12)} />,
    )
    expect(container.textContent).toContain('Survival rate')
    expect(container.textContent).toContain('Showing 10 of 12')
  })

  /*
   * 🛑 COUNTED AFTER THE FINITE FILTER, NOT BEFORE. Two unplottable rows were never going to be
   * bars; reporting "10 of 12" would swap a silent omission for a WRONG number, which is worse —
   * it looks like an answer.
   */
  it('does not count unplottable rows in the total it reports', () => {
    const data = [
      ...rows(10),
      { key: 'nan1', label: 'Broken', value: Number.NaN },
      { key: 'nan2', label: 'Broken too', value: Number.NaN },
    ]
    const { container } = render(<WorkbookBarChart title="League comparison" data={data} />)
    /* Ten plottable rows, ten drawn: nothing was cut, so nothing is claimed. */
    expect(container.textContent).not.toContain('Showing')
  })

  it('marks the note so it does not read as more subtitle', () => {
    const { container } = render(<WorkbookBarChart title="League comparison" data={rows(11)} />)
    expect(container.querySelector('[data-truncated="true"]')).not.toBeNull()
  })
})
