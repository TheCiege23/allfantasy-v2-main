/**
 * Redraft My team, phone: the three header buttons sit in a two-column grid with "Optimize lineup" across
 * the full width, instead of wrapping into two odd widths and an orphan (2026-11-06). The rule must live in
 * the phone block, so tablet and desktop keep their single row.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CSS = readFileSync(join(process.cwd(), 'components/league/native/screens/redraft-native-screens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** Body of the top-level `@media (max-width: 767px)` block, matched by brace depth so a nested block cannot hide in it. */
function phoneBlock(): string {
  const start = CSS.indexOf('@media (max-width: 767px)')
  expect(start).toBeGreaterThan(-1)
  const open = CSS.indexOf('{', start)
  let depth = 0
  for (let i = open; i < CSS.length; i += 1) {
    if (CSS[i] === '{') depth += 1
    else if (CSS[i] === '}' && (depth -= 1) === 0) return CSS.slice(open + 1, i)
  }
  throw new Error('unterminated phone block')
}

const ACTIONS = '.nl-workspace[data-format=redraft] [data-rd-screen=lineup] > .nls-head > .nls-head-actions'
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

describe('redraft My team header buttons on a phone', () => {
  it('lays them out as two equal columns, with the primary across both', () => {
    const phone = phoneBlock()
    expect(phone).not.toMatch(/@media/)
    expect(phone).toMatch(new RegExp(`${esc(ACTIONS)}\\s*\\{[^}]*display:\\s*grid;[^}]*grid-template-columns:\\s*repeat\\(2,\\s*minmax\\(0,\\s*1fr\\)\\)`))
    expect(phone).toMatch(new RegExp(`${esc(ACTIONS)} > \\.nls-btn\\[data-variant=primary\\]\\s*\\{[^}]*grid-column:\\s*1 \\/ -1`))
  })

  it('leaves the wider layouts alone', () => {
    const outside = CSS.replace(phoneBlock(), '')
    expect(outside).not.toContain(ACTIONS)
  })
})
