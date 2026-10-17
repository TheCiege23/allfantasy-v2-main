import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
}

describe('dashboard embedded league hub', () => {
  it('LeagueEmbedGate skips ProductShell when embed=1', () => {
    const src = read('components/navigation/LeagueEmbedGate.tsx')
    expect(src).toContain('isEmbedModeFromSearchParams')
    expect(src).toContain('data-af-league-embed-chrome-off')
  })

  it('League page passes embedMode from ?embed=1 into LeagueShell', () => {
    const src = read('app/league/[leagueId]/page.tsx')
    expect(src).toMatch(/embedMode/)
    expect(src).toContain('embedMode={embedMode}')
  })

  /*
   * ⚠ THIS USED TO ASSERT `embedCenterOnly={embedMode}` AND HAD FAILED SINCE 2026-05-09.
   *
   * The "FIFA" commit (e61858c4a4) removed LeagueShell's center-only AppShell and its parent-frame
   * postMessage wiring, and 15c9127811 (2026-09-05) then deleted the only consumer: the dashboards
   * that framed `/league/[id]?embed=1` in an iframe, found unreachable by an import-graph walk.
   * Nothing embeds the league hub now, so restoring center-only would rebuild layout for a parent
   * that does not exist. What LeagueShell still does with `embedMode` is asserted instead: it marks
   * the page and keeps its own chat bubble out of a host frame.
   */
  it('LeagueShell marks embed mode and keeps its chat bubble out of a host frame', () => {
    const src = read('app/league/[leagueId]/LeagueShell.tsx')
    expect(src).toMatch(/embedMode = false,/)
    expect(src).toContain("data-embed-mode={embedMode ? '1' : undefined}")
    expect(src).toMatch(/\{!embedMode \? \(\s*<ChimmyBubble\b/)
  })

  it('AppShell exposes embedCenterOnly for embedded hub column', () => {
    const src = read('app/components/AppShell.tsx')
    expect(src).toContain('embedCenterOnly')
    expect(src).toContain('data-af-embed-center')
  })
})
