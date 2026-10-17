import type { ReactNode } from 'react'

/**
 * Phone only (≤720px, CSS): a board's controls folded behind one summary row.
 *
 * ⚠ ON A PHONE THE CONTROLS WERE THE FIRST SCREEN OF THE BOARD. Division pills, eight board
 * tabs and the sort chips stacked ~220px between the rivals card and the first manager. Here
 * they sit behind one row that says what is selected ("Overall · Everyone · Sort: Rank");
 * tapping it opens them in place. Desktop and tablet never see the row — the controls render
 * as they always did.
 *
 * ⚠ A CHECKBOX, NOT <details>, AND THAT IS DELIBERATE. A <details> cannot be forced open on
 * desktop from CSS (its closed content is not rendered), and opening it from JS after mount
 * makes the board jump. The checkbox only matters inside the phone media query, needs no JS,
 * and keeps the controls in the DOM exactly once — no duplicate links for screen readers or
 * tests. It is visually hidden but focusable; the label is the tap target.
 */
export function PhoneFold({ id, summary, children }: { id: string; summary: ReactNode; children: ReactNode }) {
  return (
    <div className="af-rk-fold">
      <input type="checkbox" id={id} className="af-rk-fold-toggle" />
      <label htmlFor={id} className="af-rk-fold-summary">
        <span className="af-rk-sr">Board options: </span>
        <span className="af-rk-fold-summary-text">{summary}</span>
        <span className="af-rk-fold-chev" aria-hidden="true" />
      </label>
      <div className="af-rk-fold-body">{children}</div>
    </div>
  )
}

export default PhoneFold
