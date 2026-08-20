import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..')

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

/**
 * Regression: MLB (and other sports) post-create URLs include many query flags.
 * The league dashboard page must define `firstSearchParam` and parse params
 * before the data-load try so session redirect still sees embed mode.
 */
describe('League page MLB / post-create handoff', () => {
  const leaguePage = read('app/league/[leagueId]/page.tsx')

  it('parses search params once before session and reuses them in the data try', () => {
    const decl = 'const sp = searchParams ? await searchParams : {}'
    expect(leaguePage).toContain(decl)
    const n = leaguePage.split(decl).length - 1
    expect(n).toBe(1)
  })

  it('supports post-create flags used after MLB create redirect', () => {
    expect(leaguePage).toContain('isPostCreateLeagueShellHandoff(sp)')
    expect(leaguePage).toContain('isTruthySearchParam(sp.playIntro)')
    expect(leaguePage).toContain('firstSearchParam(sp.openChat)')
  })
})
