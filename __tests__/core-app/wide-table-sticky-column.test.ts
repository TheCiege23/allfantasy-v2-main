import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The three wide /core tables that scroll sideways on a phone keep their first (name) column
 * pinned, with an opaque background so scrolled columns cannot show through it.
 */

const css = (f: string) => readFileSync(resolve(__dirname, '../../components/core-app', f), 'utf8')

/** The declaration block for an exact selector list, as written. */
function rule(source: string, selectors: string): string {
  // Last occurrence: af-commish.css already uses the same selector list for text-align.
  const at = source.lastIndexOf(selectors + ' {')
  expect(at, selectors).toBeGreaterThan(-1)
  return source.slice(at, source.indexOf('}', at))
}

const CASES: Array<[string, string]> = [
  ['af-season-outlook.css', ".af-so-table thead th:first-child,\n.af-so-table th[scope='row']"],
  ['af-season-outlook-league.css', '.af-sol-table thead th:first-child,\n.af-sol-table tbody th'],
  ['af-commish.css', '.af-core .af-cm-table th:first-child,\n.af-core .af-cm-table td:first-child'],
]

describe('wide tables pin their name column', () => {
  for (const [file, selectors] of CASES) {
    it(`${file}: sticky at left 0 with an opaque surface`, () => {
      const block = rule(css(file), selectors)
      expect(block).toMatch(/position: sticky;/)
      expect(block).toMatch(/left: 0;/)
      expect(block).toMatch(/background: var\(--surface\);/)
    })
  }

  it("keeps the viewer's row tinted in the pinned cell", () => {
    expect(css('af-season-outlook-league.css')).toContain(
      "tr[data-you='true'] th {\n  background: linear-gradient(var(--accent-soft), var(--accent-soft)), var(--surface);",
    )
  })
})
