import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
}

describe('league post-create handoff props wiring', () => {
  it('League page maps post-create search params to LeagueShell props', () => {
    const src = read('app/league/[leagueId]/page.tsx')
    expect(src).toContain('const createdFromLeagueCreate = isPostCreateLeagueShellHandoff(sp)')
    expect(src).toContain('const defaultShowInvite = isTruthySearchParam(sp.showInvite)')
    /*
     * ⚠ WHITESPACE-EXACT, AND THE FORMATTER MOVED THE LINE. The expression is
     * unchanged; it is simply wrapped after the `=` now:
     *
     *     const defaultOpenChat =
     *       normalizeOpenChatQueryParam(firstSearchParam(sp.openChat)) === 'league' ? 'league' : null
     *
     * A `toContain` on a full source line cannot survive a reflow, and nothing
     * about this test's intent depends on where the break falls. Matched with a
     * whitespace-tolerant regex so the assertion tracks the LOGIC — normalize the
     * query param, accept only 'league', otherwise null.
     */
    expect(src).toMatch(
      /const defaultOpenChat =\s*normalizeOpenChatQueryParam\(firstSearchParam\(sp\.openChat\)\) === 'league' \? 'league' : null/,
    )
    expect(src).toContain('const shouldPlayIntro = isTruthySearchParam(sp.playIntro)')
    expect(src).toContain('createdFromLeagueCreate={createdFromLeagueCreate}')
    expect(src).toContain('defaultShowInvite={defaultShowInvite}')
    expect(src).toContain('defaultOpenChat={defaultOpenChat}')
    expect(src).toContain('shouldPlayIntro={shouldPlayIntro}')
  })

  it('LeagueShell accepts and consumes post-create handoff props', () => {
    const src = read('app/league/[leagueId]/LeagueShell.tsx')
    expect(src).toContain('createdFromLeagueCreate?: boolean')
    expect(src).toContain('defaultShowInvite?: boolean')
    expect(src).toContain("defaultOpenChat?: 'league' | null")
    expect(src).toContain('shouldPlayIntro?: boolean')
    expect(src).toContain('defaultShowInvite = false')
    expect(src).toContain('defaultOpenChat = null')
    expect(src).toContain('shouldPlayIntro = false')
    expect(src).toContain("openLeagueSettingsModal('invite')")
    expect(src).toContain('defaultOpenChat ?? normalizeOpenChatQueryParam(openChatQuery) ?? \'league\'')
  })
})
