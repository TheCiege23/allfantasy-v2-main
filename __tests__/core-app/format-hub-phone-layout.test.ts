import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Two phone-width defects found auditing the six format hubs (2026-11-07):
 *
 *  1. The Tournament hub's connect row holds two fixed-width buttons and did not wrap, so the second
 *     ("Your tournaments and weekly reports") ran to 508px on a 390px screen and was clipped.
 *  2. The workbook bar chart reserved 18px above its tallest bar. A value label sits 7px above its bar
 *     and wraps to two 11px lines in a narrow column, and the plot's `overflow-x: auto` clips
 *     vertically too — so the tallest bar's label lost its first line ("8 zombie · 2 human" read
 *     "human"; "5 of 5 devy slots" read "slots"). The chart is shared, so every hub had it.
 */
const read = (p: string) =>
  readFileSync(path.join(process.cwd(), p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => ' '.repeat(c.length))

function rule(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`)
  if (at < 0) throw new Error(`no rule ${selector}`)
  const before = css.slice(0, at)
  if (before.split('{').length !== before.split('}').length) throw new Error(`${selector} is nested`)
  return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
}

describe('format hub connect row', () => {
  const hubs = read('components/core-app/af-format-hubs.css')

  it('wraps, and its buttons may shrink and wrap their words', () => {
    expect(rule(hubs, '.af-core .afh-connect-row')).toMatch(/flex-wrap:\s*wrap/)
    const btn = rule(hubs, '.af-core .afh-connect-row > .afh-btn')
    expect(btn).toMatch(/flex:\s*0 1 auto/)
    expect(btn).toMatch(/min-width:\s*0/)
    expect(btn).toMatch(/white-space:\s*normal/)
  })

  /*
   * 🛑 THE FIRST VERSION OF THIS FIX CLOSED THE ROW'S RULE EARLY TO INSERT THE BUTTON RULE, and the row's
   * remaining declarations — padding, background, border, radius — fell into the BUTTON rule. Braces still
   * balanced; the buttons turned into dark boxes with dark text. Pin both sides of the boundary.
   */
  it("keeps the row's own frame on the row, and puts none of it on the buttons", () => {
    const row = rule(hubs, '.af-core .afh-connect-row')
    expect(row).toMatch(/padding:\s*11px/)
    expect(row).toMatch(/background:\s*var\(--surface2\)/)
    expect(row).toMatch(/border:\s*1px solid var\(--line\)/)
    expect(row).toMatch(/border-radius:\s*11px/)
    const btn = rule(hubs, '.af-core .afh-connect-row > .afh-btn')
    expect(btn).not.toMatch(/(^|[;\s])(background|padding|border|border-radius|color)\s*:/)
  })
})

describe('workbook bar chart headroom', () => {
  const chart = read('components/core-app/charts/workbook-chart.css')
  const top = (decl: string) => Number(/^\s*(\d+)px/.exec(decl)?.[1])

  it('leaves room above the tallest bar for a two-line value label', () => {
    const plot = /padding:\s*([^;]+);/.exec(rule(chart, '.af-workbook-plot'))![1]
    // 7px gap + two lines of 11px/1 type = 29px.
    expect(top(plot)).toBeGreaterThanOrEqual(29)
  })

  it('moves the gridlines with it, so they still frame the bars', () => {
    const plot = /padding:\s*([^;]+);/.exec(rule(chart, '.af-workbook-plot'))![1]
    const grid = /inset:\s*([^;]+);/.exec(rule(chart, '.af-workbook-grid'))![1]
    expect(grid.trim()).toBe(plot.trim())
  })
})
