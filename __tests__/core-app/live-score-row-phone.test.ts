import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Live scores on a phone (2026-11-24, the simplify pass): each team is one row — crest, name, score at the
 * right end. The score used to take a row of its own under the name (`grid-column: 1 / -1` at 34px), so a
 * game's two teams were ~200px tall; measured with Playwright on /e2e/live-guide?mode=live, 83px at 390px.
 * jsdom does no layout, so this pins the rule the measurement rests on.
 */
const css = readFileSync(resolve(process.cwd(), 'components/core-app/af-live.css'), 'utf8')

describe('a live game on a phone', () => {
  it('puts the score in a third column of the team row, not a row of its own', () => {
    expect(css).toContain(
      ".af-core .af-live-side-team, .af-core .af-live-side-team[data-align='end'] { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto;",
    )
    expect(css).toContain('.af-core .af-live-team-score { grid-column: 3;')
    expect(css).not.toMatch(/\.af-live-team-score \{ grid-column: 1 \/ -1;/)
  })
})
