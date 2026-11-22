/**
 * The head-to-head board look (af-matchup-h2h.css, 2026-11-09): larger rows on a wide board, one
 * continuous list. It must not reach the phone board, whose two-row halves and SUPER_FLEX wrap fix are
 * recorded in af-matchup.css, and it must not name a colour — themes own colour through tokens.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const H2H = readFileSync(join(process.cwd(), 'components/core-app/af-matchup-h2h.css'), 'utf8')
const SCREEN = readFileSync(join(process.cwd(), 'components/core-app/screens/Matchup.tsx'), 'utf8')
const BASE = readFileSync(join(process.cwd(), 'components/core-app/af-matchup.css'), 'utf8')
const code = H2H.replace(/\/\*[\s\S]*?\*\//g, '')

describe('the head-to-head board look', () => {
  it('is switched on by the board itself, and loaded after the base and redraft sheets', () => {
    expect(SCREEN).toMatch(/className="af-mu-board" data-look="h2h"/)
    const base = SCREEN.indexOf("af-core-redraft-matchup.css'")
    const h2h = SCREEN.indexOf("af-matchup-h2h.css'")
    expect(base).toBeGreaterThan(-1)
    expect(h2h).toBeGreaterThan(base)
  })

  it('lives entirely inside the wide-board container query, the complement of the phone block', () => {
    expect(BASE).toContain('@container af-mu (max-width: 760px)')
    const open = code.indexOf('@container af-mu (min-width: 761px) {')
    expect(open).toBeGreaterThan(-1)
    // Nothing before the query, and the query's closing brace is the last thing in the file.
    expect(code.slice(0, open).trim()).toBe('')
    let depth = 0
    let end = -1
    for (let i = open; i < code.length; i += 1) {
      if (code[i] === '{') depth += 1
      if (code[i] === '}') {
        depth -= 1
        if (depth === 0) { end = i; break }
      }
    }
    expect(end).toBeGreaterThan(open)
    expect(code.slice(end + 1).trim()).toBe('')
  })

  it('scopes every rule to the h2h board', () => {
    const inner = code.slice(code.indexOf('{') + 1, code.lastIndexOf('}'))
    const selectors = inner.split('}').map((block) => block.split('{')[0].trim()).filter(Boolean)
    expect(selectors.length).toBeGreaterThan(5)
    for (const group of selectors) {
      for (const sel of group.split(',')) expect(sel.trim()).toMatch(/^\.af-mu-board\[data-look='h2h'\]/)
    }
  })

  it('names no colour of its own', () => {
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(code).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/)
  })
})
