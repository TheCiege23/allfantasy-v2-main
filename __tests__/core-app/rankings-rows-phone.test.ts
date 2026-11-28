import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The Community board's phone rows in two lines, not three (2026-11-24, the simplify pass).
 *
 * jsdom does no layout, so this pins the CSS contract that the phone measurement rests on (measured with
 * Playwright at 320–700px: 103px → 81px a row, no name/score or sub-line/chip overlap, desktop untouched):
 *   - the rules live inside `@media (max-width: 720px)`;
 *   - they apply only to rows with a Why button (`.af-rk-cellbtn`), so the portfolio, league and Class
 *     tables keep their layout;
 *   - the title spans both lines and the chips sit on line two;
 *   - an open "More" drops to its own full-width line.
 */
const css = readFileSync(resolve(process.cwd(), 'components/core-app/af-rankings-screen.css'), 'utf8')

function phoneRowsBlock(): string {
  const at = css.indexOf('Phone rows in two lines, not three')
  expect(at).toBeGreaterThan(-1)
  const media = css.indexOf('@media (max-width: 720px) {', at)
  expect(media).toBeGreaterThan(at)
  // The block runs to the brace that closes the @media.
  let depth = 0
  for (let i = css.indexOf('{', media); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    if (css[i] === '}' && --depth === 0) return css.slice(media, i + 1)
  }
  throw new Error('unclosed @media')
}

describe('Community board rows on a phone', () => {
  it('scopes every rule to rows with a Why button', () => {
    const block = phoneRowsBlock().replace(/\/\*[\s\S]*?\*\//g, '')
    const selectors = block.match(/[^{}]+(?=\{)/g)!.slice(1).map((s) => s.trim())
    expect(selectors.length).toBeGreaterThan(4)
    for (const sel of selectors) for (const part of sel.split(',')) expect(part, part).toContain('tr[data-phonemore]:has(.af-rk-cellbtn)')
  })

  it('makes the row a grid: title over both lines, chips on line two, an open More on a line of its own', () => {
    const block = phoneRowsBlock()
    expect(block).toMatch(/:has\(\.af-rk-cellbtn\) \{\s*display: grid;/)
    expect(block).toMatch(/\[data-card='title'\] \{[^}]*grid-row: 1 \/ span 2;/)
    expect(block).toMatch(/\[data-card='detail'\],\s*[^{]*td\.af-rk-phonemore \{[^}]*grid-row: 2;/)
    expect(block).toMatch(/details\[open\]\) \{[^}]*grid-column: 1 \/ -1;[^}]*grid-row: 3;/)
  })
})
