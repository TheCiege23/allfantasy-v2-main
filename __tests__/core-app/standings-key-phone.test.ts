/**
 * Standings on a phone (2026-11-07): the status key follows the table. Live at 375px the cards began
 * 1,400px down with the 119px key above them; now 1,267px, and in Table view the key sits right after
 * the table, never at the bottom of the page.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')

describe('the standings key on a phone', () => {
  it('orders the key after the main view and before "How this table works", in a top-level phone query', () => {
    const code = read('components/core-app/af-standings.css').replace(/\/\*[\s\S]*?\*\//g, '')
    const start = code.lastIndexOf('@media (max-width: 640px) {')
    const before = code.slice(0, start)
    expect((before.match(/\{/g) ?? []).length).toBe((before.match(/\}/g) ?? []).length)
    const block = code.slice(start)
    expect(block).toMatch(/\.af-core \.af-stb > \.af-stb-how,\s*\.af-core \.af-stb > \.af-stb-how ~ \* \{\s*order: 2;/)
    expect(block).toMatch(/\.af-core \.af-stb > \.af-stb-legend \{\s*order: 1;/)
  })

  it('anchors on a block every layout renders: "How this table works" is unconditional and after the view', () => {
    const tsx = read('components/core-app/standings/StandingsBoardView.tsx')
    const view = tsx.indexOf('{picture ? (')
    const how = tsx.indexOf('<details className="af-stb-notes af-stb-how">')
    const legend = tsx.indexOf('<ul className="af-stb-legend"')
    expect(view).toBeGreaterThan(-1)
    expect(legend).toBeGreaterThan(-1)
    expect(legend).toBeLessThan(view)
    expect(how).toBeGreaterThan(view)
    // Not wrapped in a condition: the line before it is a comment block, not `? (` or `&& (`.
    expect(tsx.slice(Math.max(0, how - 200), how)).not.toMatch(/(\?|&&)\s*\(\s*$/)
  })
})
