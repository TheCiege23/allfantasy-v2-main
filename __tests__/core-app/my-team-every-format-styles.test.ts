import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 🛑 MY TEAM'S BASE LOOK MUST NOT DEPEND ON THE REDRAFT STAMP.
 *
 * Found in the 2026-11-06 best ball audit: "Go to matchup" was styled ONLY under
 * `[data-format=redraft]`, so every other format (best ball, dynasty, …) rendered a raw 18px white
 * link with no arrow. And the highlights card's line, picker and button leaned on the player-card
 * sheet's base size, so on My Team they inherited 18px body text in every format.
 *
 * Each rule is asserted at brace depth 0 — a rule that slides inside an @media block, or back
 * under the redraft selector, is exactly how the first one went missing without anything failing.
 */
const read = (p: string) =>
  readFileSync(path.join(process.cwd(), p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => ' '.repeat(c.length))

function topLevelRule(css: string, selector: string): string {
  // The selector must START a rule (file start or right after a `}`), so a scoped
  // `[data-format=redraft] .x` never passes for a bare `.x`.
  const re = new RegExp(`(^|\\})(\\s*)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`, 'g')
  for (const m of css.matchAll(re)) {
    const at = m.index! + m[1].length + m[2].length
    const before = css.slice(0, at)
    if (before.split('{').length - before.split('}').length !== 0) continue
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
  }
  throw new Error(`no top-level rule for ${selector}`)
}

describe('My Team styles that every league format gets', () => {
  const myTeam = read('components/core-app/af-my-team.css')
  const playerCard = read('components/core-app/af-player-card.css')

  it('"Go to matchup" has a base style, not only a redraft one', () => {
    const rule = topLevelRule(myTeam, '.af-mt-mu-go')
    expect(rule).toMatch(/font-size:\s*14px/)
    expect(rule).toMatch(/color:\s*var\(--accent\)/)
    expect(topLevelRule(myTeam, '.af-mt-mu-go::after')).toMatch(/content:\s*'\\2192'/)
  })

  it('the highlights card sets its own text size', () => {
    expect(topLevelRule(playerCard, '.af-team-highlights')).toMatch(/font-size:\s*13px/)
  })

  it('the bench-check Chimmy button sets its own text size', () => {
    expect(topLevelRule(myTeam, '.af-core .af-mt-bench-ask')).toMatch(/font-size:\s*13px/)
  })

  // Control: the helper must REFUSE a rule that exists only inside an at-rule or a scope.
  it('the helper rejects a nested-only rule', () => {
    expect(() => topLevelRule('@media (max-width: 1px) { .x { color: red } }', '.x')).toThrow()
    expect(() => topLevelRule('.a[data-format=redraft] .x { color: red }', '.x')).toThrow()
  })
})
