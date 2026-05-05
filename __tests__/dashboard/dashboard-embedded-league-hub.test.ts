import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
}

describe('dashboard embedded league hub', () => {
  it('SelectedLeagueHomePanel loads full hub via embed iframe (no primary Open full league hub CTA)', () => {
    const src = read('app/dashboard/components/SelectedLeagueHomePanel.tsx')
    expect(src).toContain('?embed=1')
    expect(src).toContain('dashboard-embedded-league-hub-iframe')
    expect(src).not.toMatch(/Open full league hub/)
    expect(src).toContain('dashboard-league-home-open-full-secondary')
  })

  it('DashboardShell keeps three-panel shell when a league is selected', () => {
    const src = read('app/dashboard/DashboardShell.tsx')
    expect(src).toContain('SelectedLeagueHomePanel')
    expect(src).toContain('<LeftChatPanel')
    expect(src).toContain('<RightControlPanel')
    expect(src).toContain("initialOpenChat={effectiveActiveLeagueId ? 'league' : null}")
  })

  it('League page passes embedMode from ?embed=1 into LeagueShell', () => {
    const src = read('app/league/[leagueId]/page.tsx')
    expect(src).toMatch(/embedMode/)
    expect(src).toContain('embedMode={embedMode}')
  })

  it('LeagueShell supports embed mode (center-only AppShell)', () => {
    const src = read('app/league/[leagueId]/LeagueShell.tsx')
    expect(src).toContain('embedMode')
    expect(src).toContain('embedCenterOnly={embedMode}')
  })

  it('AppShell exposes embedCenterOnly for embedded hub column', () => {
    const src = read('app/components/AppShell.tsx')
    expect(src).toContain('embedCenterOnly')
    expect(src).toContain('data-af-embed-center')
  })
})
